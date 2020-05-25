#!/usr/bin/env node

const axios = require('axios');
const _ = require('lodash');
const CatalogSolr = require('./lib/CatalogSolr');
const ROCrate = require('ro-crate').ROCrate;
const fs = require('fs-extra');
const path = require('path');
const OCFLRepository = require('ocfl').Repository;
const uuidv1 = require('uuid/v1');
const hasha = require('hasha');
const prompts = require('prompts');

const DEFAULT_CONFIG = './config.json';

const yargs = require('yargs');

var argv = require('yargs')
    .usage('Usage: $0 [options]')
    .describe('c', 'Config file')
    .alias('c', 'config')
    .default('c', DEFAULT_CONFIG)
    .alias('p', 'purge')
    .describe('p', 'Purge solr')
    .boolean('p')
    .default('p', false)
    .help('h')
    .alias('h', 'help')
    .argv;


// FIXME - do this with an async file read and don't make a bunch
// of global variables

const configPath = argv.config;


if (!fs.existsSync(configPath)) {
  console.error(`Please provide a valid config file path: ${configPath}`);
  process.exit(1);
}



const configJson = fs.readJsonSync(configPath);
const retry = configJson['retry'] || 10;
const retryInterval = configJson['retryInterval'] || 10;
const solrBase = configJson['solrBase'] || '';
const solrUpdate = solrBase + '/update/json';
const solrSchema = solrBase + '/schema';
const solrPing = solrBase + '/admin/ping';
const fieldConfig = fs.readJsonSync(configJson['fields']);
const logLevel = configJson['logLevel'] || 4;
const waitPeriod = configJson['waitPeriod'] || 0;
const batchNum = configJson['batch'] || 1000;
const catalogFilename = configJson['catalogFilename'] || 'CATALOG.json';
const uriIds = configJson['uriIds'] || 'hashpaths';
const hashAlgorithm = configJson['hashAlgorithm'] || 'md5';      
const sourcePath = configJson['ocfl'];
const dumpDir = configJson['dump'];

const dryRun = configJson['dryRun'] || false;

const sleep = ms => new Promise((r, j) => {
  console.log('Waiting for ' + ms + ' seconds');
  setTimeout(r, ms * 1000);
});


function commitDocs(solrURL, args) {
  return axios({
    url: solrURL + args,
    method: 'get',
    responseType: 'json',
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

function updateDocs(solrURL, coreObjects) {
  console.log('updateDocs: ' + solrURL);
  return axios({
    url: solrURL + '/docs',
    method: 'post',
    data: coreObjects,
    responseType: 'json',
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}





async function updateSchema(solrURL, schemaFile) {
  const schemaConf = await fs.readJson(schemaFile);

  for( const type of Object.keys(schemaConf) ) {
    for( const field of schemaConf[type] ) {
      //console.log(`Setting schema field ${type} ${JSON.stringify(field)}`);
      await setSchemaField(solrURL, type, field);
    }
  }
}


async function setSchemaField(solrURL, fieldtype, schemaJson) {
  const url = solrURL + '/' + fieldtype + 's';
  const schemaAPIJson = {};
  const name = schemaJson['name'];

  // solr copyfields are annoying because they don't have a name and
  // can't be replaced, so I'm trying to delete them and ignoring errors.

  if( fieldtype === 'copyfield' ) {
    console.log(`Deleting copyfield ${JSON.stringify(schemaJson)}`);
    await tryDeleteCopyField(solrURL, schemaJson);
    schemaAPIJson['add-copy-field'] = schemaJson;
  } else {
    const apifield = ( fieldtype === 'field' ) ? 'field' : 'dynamic-field';
    if( await schemaFieldExists(url, name) ) {
      console.log(`Schema: replacing ${fieldtype} ${name}`);
      schemaAPIJson['replace-' + apifield] = schemaJson;
    } else {    
      console.log(`Schema: adding ${fieldtype} ${name}`);
      schemaAPIJson['add-' + apifield] = schemaJson;
    }
  }

  try {
    console.log(`Posting to schema API ${url} ${JSON.stringify(schemaAPIJson)}`);
    const response = await axios({
      url: solrURL,
      method: 'post',
      data: schemaAPIJson,
      responseType: 'json',
      headers: {
      'Content-Type': 'application/json; charset=utf-8'
      }
    });
    //console.log("Response: " + response.status);
  } catch(e) {
    console.log("Error updating schema");
    console.log(`URL: ${url}`);
    console.log(`schemaAPIJson: ${JSON.stringify(schemaAPIJson)}`);
    if( e.response ) {
      console.log(`${e.response.status} ${e.response.statusText}`);
    } else {
      console.log(e);
    }
  }
}

async function schemaFieldExists(solrURL, field) {
  const url = solrURL + '/' + field;
  try {
    const resp = await axios ({
      url: url,
      method: 'get',
      responseType: 'json', 
    });
    console.log("Schema field " + field + " already exists");
    return true;
  } catch(e) {
    if( e.response.status === 404 ) {
      console.log("Schema field " + field + " not found");
      return false;
    } else {
      console.log("unknown error " + e);
      throw(e);
      return false;
    } 
  }
}

async function tryDeleteCopyField(solrURL, copyFieldJson) {
  try {
    const resp = await axios ({
      url: solrURL,
      method: 'post',
      data: { "delete-copy-field": { source: copyFieldJson['source'], dest: copyFieldJson['dest'] } },
      responseType: 'json',
      headers: {
      'Content-Type': 'application/json; charset=utf-8'
      }
    });
    console.log("copyfield removed");
    return true;
  } catch(e) {
    if( e.response ) {
      if( e.response.status === 404 ) {
        console.log("Schema field " + field + " not found");
        return false;
      } else {
        console.log("copy field delete error " + e.response.status);
        return false;
      }
    } else { 
      console.log("unknown error " + e);
      throw(e);
      return false;
    } 
  }
}


async function checkSolr() {
  for( let i = 0; i < retry; i++ ) {
    console.log(`Pinging Solr - attempt ${0} of ${retry}`)  
    try {
      const response = await axios({
        url: solrPing,
        method: 'get',
        responseType: 'json'
      });
      if( response.status == 200 ) {
        if( response.data['status'] === 'OK' ) {
          return true;
        }
      }
    } catch(e) {
      console.log(`Solr ping failed`);
    }
    await sleep(retryInterval);
  }
  console.log(`Maximum connection attempts ${retry}`);
  return false;
}






async function purgeSolr() {

  try {
    const response = await axios({
      url: solrUpdate + '?commit=true',
      method: 'post',
      data: '{ "delete": { "query": "*:*"} }',
      responseType: 'json',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
    });
    console.log("All solr documents deleted.");
    return true
  } catch(e) {
    if( e.response ) {
      console.log("Solr error");

      console.log(e.response.status);
      return false;
    } else {
      console.log("General error");
      console.log(e);
      process.exit(-1);
    }
  }
}





async function loadFromOcfl(repoPath) {
  const repo = new OCFLRepository();
  await repo.load(repoPath);

  const objects = await repo.objects();
  const records = [];

  for ( let object of objects ) {
    const inv = await object.getInventory();
    var headState = inv.versions[inv.head].state;
    for (let hash of Object.keys(headState)){
      if (headState[hash].includes(catalogFilename)) {
        const jsonfile = path.join(object.path, inv.manifest[hash][0]);
        const json = await fs.readJson(jsonfile);
        records.push({
          path: path.relative(repoPath, object.path),
          hash_path: hasha(object.path, { algorithm: hashAlgorithm }),
          jsonld: json,
          ocflObject: object
        });
      } else {
       // console.log(`No ${catalogFilename} found in ${object['path']}`);
      }
    }
  }
  return records;
  
}


async function dumpDocs(jsonld, solrDocs) {
  const id = jsonld['hash_path'];
  await fs.writeJson(path.join(dumpDir, `${id}.json`), solrDocs, { spaces: 2});
}


// making this async so that the indexer can do async operations like
// load a payload file for full-text search 


async function solrObjects(records) {
  let indexer = new CatalogSolr();
  if( !indexer.setConfig(fieldConfig) ) {
    console.log("Solr config error");
    return [];
  }
  const solrDocs = [];
  for( record of records ) {
    try {
      const jsonld = record['jsonld'];
      const docs = await indexer.createSolrDocument(record['jsonld'], async (fpath) => {
        const relpath = await record['ocflObject'].getFilePath(fpath);
        return path.join(sourcePath, record['path'], relpath);
      });
      if (docs) {
        console.log(`Got solr docs of type: ${Object.keys(docs)}`);
        if( dumpDir ) {
          await dumpDocs(record, docs);
        }
        for (let t of Object.keys(docs)){
          if (t  === "Dataset") {
            docs.Dataset.forEach((dataset) => {
              dataset['path'] = record['path'];
              if( uriIds === 'hashpaths' ) {
                dataset['uri_id'] = record['hash_path'];
              } else {
                if( dataset['id'] && Array.isArray(dataset['id']) ) {
                  dataset['uri_id'] = dataset['id'][0];
                } else {
                  console.log("Warning: couldn't find id for uri_id");
                }
              };
              solrDocs.push(dataset);
            });
          }  else {
            docs[t].forEach((item) => {
              solrDocs.push(item);
            });
          }
      }
      
      }
    } catch(e) {
      console.log("Error converting ro-crate to solr");
      console.log(`path: ${record['path']}`);
      console.log(`uri_id: ${record['uri_id']}`);
      console.log(e);
    }

  }
  indexer = null;
  return solrDocs;
}



// Note: I think this could use a rewrite to put it into a more easy-to-understand
// async/await style rather than relying on explicit Promise operations


async function commitBatches (records) {
  console.log("updating " + records.length + " records");
  const batch = _.chunk(records, batchNum);

  batch.reduce((promise, records, index) => {
    return promise.then(async () => {
      if (logLevel >= 4) {
        reportMemUsage();
      }
      const solrDocs = await solrObjects(records);
      if( dryRun ) {
        console.log("Dry-run mode, not committing");
        return Promise.resolve();
      }
      return updateDocs(solrUpdate, solrDocs).then(async () => {
        if (waitPeriod) {
          const waited = await sleep(waitPeriod);
        }
        console.log(`batch ${index + 1} of ${batch.length} : Update docs`);
        if (index >= batch.length - 1) {
          return commitDocs(solrUpdate, '?commit=true&overwrite=true').then(() => {
            return Promise.resolve();
          });
        }
        return Promise.resolve();
      });
    }).catch((e) => {
      console.log("Update failed: " + e);
      if( e.response ) {
        console.log(e.response.status);
      } else {
        console.log(JSON.stringify(e));
      }
    })
  }, Promise.resolve());

}

// this is a basic version which loops through the record, indexes and commits
// them one at a time, so a single bad record won't prevent an entire indexing
// run



async function indexRecords(records) {
  const solrDocs = await solrObjects(records);

  for( const doc of solrDocs ) {
    try {
      await updateDocs(solrUpdate, [ doc ]);
      await commitDocs(solrUpdate, '?commit=true&overwrite=true');
      console.log(`Indexed ${doc['record_type_s']} ${doc['id']}`);
    } catch(e) {
      console.log("Update failed: " + e);
      if( e.response ) {
        console.log(e.response.status);
      }      
    }
  }
}


function reportMemUsage() {
   console.log(`Using: ${Math.round(process.memoryUsage().rss / 1024 / 1024 * 100) / 100} MBs`);
}

async function dumpSolrSync(solr) {
  const uuname = path.join('test-data', uuidv1() + '.json');
  fs.writeJsonSync(uuname, solr, { spaces: 2 });
  console.log(`Wrote solr docs to ${uuname}`); 
}


async function main () {

  let indexer = new CatalogSolr();
  if( !indexer.setConfig(fieldConfig) ) {
    return;
  }

  const solrUp = await checkSolr();

  if( solrUp ) {
    console.log("Solr is responding to pings");
    if( configJson['purge'] ) {
      await purgeSolr();
    }


    if( configJson['updateSchema'] ) {
      await updateSchema(solrSchema, configJson['schema']);
    }


    const records = await loadFromOcfl(sourcePath);
    await indexRecords(records);
  } else {
    console.log("Couldn't connect to Solr");
  }
}


main();



