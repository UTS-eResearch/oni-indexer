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
    .default('p', true)
    .help('h')
    .alias('h', 'help')
    .argv;


const configPath = argv.config;


if (!fs.existsSync(configPath)) {
  console.error(`Please provide a valid config file path: ${configPath}`);
  process.exit(1);
}

const configJson = fs.readJsonSync(configPath);
const solrBase = configJson['solrBase'] || '';
const solrUpdate = solrBase + '/update/json';
const solrSchema = solrBase + '/schema';
const fieldConfig = fs.readJsonSync(configJson['fields']);
const logLevel = configJson['logLevel'] || 4;
const waitPeriod = configJson['waitPeriod'] || 0;
const batchNum = configJson['batch'] || 1000;
const catalogFilename = configJson['catalogFilename'] || 'CATALOG.json';
const uriIds = configJson['uriIds'] || 'hashpaths';
const hashAlgorithm = configJson['hashAlgorithm'] || 'md5';      
const sourcePath = configJson['ocfl'];

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
      console.log(`Setting schema field ${type} ${JSON.stringify(field)}`);
      await setSchemaField(solrURL, type, field);
    }
  }
}


async function setSchemaField(solrURL, fieldtype, schemaJson) {
  const url = solrURL + '/fields';
  const schemaAPIJson = {};
  if( fieldtype !== 'copy-field' ) {
    const name = schemaJson['name'];
    if( await schemaFieldExists(solrURL, name) ) {
      console.log("replacing it");
      schemaAPIJson['replace-' + fieldtype] = schemaJson;
    } else {    
      console.log("adding it");
      schemaAPIJson['add-' + fieldtype] = schemaJson;
    }
  } else {
    schemaAPIJson['add-copy-field'] = schemaJson;
  }

  try {
    console.log(`Posting to schema API ${url} ${JSON.stringify(schemaAPIJson)}`);
    const response = await axios({
      url: url,
      method: 'post',
      data: schemaAPIJson,
      responseType: 'json',
      headers: {
      'Content-Type': 'application/json; charset=utf-8'
      }
    });
    console.log("Response: " + response.status);
  } catch(e) {
    console.log("Error updating schema");
  }
}

async function schemaFieldExists(solrURL, field) {
  const url = solrURL + '/fields/' + field;
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
    console.log("Solr error");
    console.log(e.response.status);
    return false;
  }
}





async function loadFromOcfl(repoPath) {
  const repo = new OCFLRepository();

  console.log(">>> OCFL " + repoPath);

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
          jsonld: json
        });
      } else {
        console.log(`No ${catalogFilename} found in ${object['path']}`);
      }
    }
  }
  return records;
  
}



// 


function solrObjects(recs) {
  let indexer = new CatalogSolr();
  if( !indexer.setConfig(fieldConfig) ) {
    console.log("Solr config error");
    return [];
  }
  const solrDocs = [];
  recs.forEach((record) => {
    try {
      const jsonld = record['jsonld'];
      const docs = indexer.createSolrDocument(jsonld);
      if (docs) {
        for (let t of Object.keys(docs)){
          if (t  === "Dataset") {
            docs.Dataset.forEach((dataset) => {
              console.log("Dataset (a) = " + JSON.stringify(dataset));              
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
              console.log("Dataset (b) = " + JSON.stringify(dataset));
              solrDocs.push(dataset);
              console.log(`Dataset URI id ${dataset['uri_id']}`);
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

  });
  indexer = null;
  return solrDocs;
}




async function commitBatches (records) {
  console.log("updating " + records.length + " records");
  const batch = _.chunk(records, batchNum);

  batch.reduce((promise, records, index) => {
    return promise.then(() => {
      if (logLevel >= 4) {
        reportMemUsage();
      }
      const solrDocs = solrObjects(records);
      if( dryRun ) {
        console.log("Dry-run mode, not committing");
        return Promise.resolve();
      }
      return updateDocs(solrUpdate, solrDocs).then(async () => {
        if (waitPeriod) {
          const waited = await sleep(waitPeriod);
        }
        console.log(`batch ${index} of ${batch.length} : Update docs`);
        if (index >= batch.length - 1) {
          return commitDocs(solrUpdate, '?commit=true&overwrite=true').then(() => {
            return Promise.resolve();
          });
        }
        return Promise.resolve();
      });
    }).catch((e) => {
      console.log("Update failed");
      console.log(e.response.status);
    })
  }, Promise.resolve());

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


  if( argv.purge ) {
    const response = await prompts({
      name: 'purge',
      type: 'confirm',
      message: 'Are you sure that you want to purge all Solr documents before reindexing?'
    });
    if( response['purge'] ) {
      await purgeSolr();
    } 
  }

  if( configJson['updateSchema'] ) {
    await updateSchema(solrSchema, configJson['schema']);
  }

  const records = await loadFromOcfl(sourcePath);  
  await commitBatches(records);
}


main();



