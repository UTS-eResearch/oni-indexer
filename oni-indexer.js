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
const winston = require('winston');

const consoleLog = new winston.transports.Console();
const logger = winston.createLogger({
  format: winston.format.simple(),
  transports: [ consoleLog ]
});

const DEFAULTS = {
  'config': './config.json',
  'schemaBase': './config/schema_base.json',
  'retries': 10,
  'retryInterval': 10,
  'catalogFilename': 'ro-crate-metadata.jsonld',
  'uriIds': 'hashpaths',
  'updateSchema': true,
  'hashAlgorithm': 'md5',
  'logLevel': 'warn'
};

var argv = require('yargs')
    .usage('Usage: $0 [options]')
    .describe('c', 'Config file')
    .alias('c', 'config')
    .default('c', DEFAULTS['config'])
    .alias('i', 'item')
    .describe('i', 'Index a single item')
    .string('i')
    .help('h')
    .alias('h', 'help')
    .argv;

const configPath = argv.config;

const sleep = ms => new Promise((r, j) => {
  setTimeout(r, ms * 1000);
});


main(argv);

async function main (argv) {
  let cf;
  
  try {
    cf = await fs.readJson(argv.config);
  } catch(e) {
    logger.error("Configuration error");
    logger.error(e);
    return;
  }

  for ( let key in DEFAULTS ) {
    if( !cf[key] ) {
      cf[key] = DEFAULTS[key];
      logger.info(`Using default config ${key}: ${cf[key]}`);
    }
  }

  if( cf['debug'] && cf['logLevel'] !== 'debug' ) {
    logger.info(`Log level changed from ${cf['logLevel']} to debug because the config has a debug section`);
    cf['logLevel'] = 'debug';
  }

  consoleLog.level = cf['logLevel'];

  if( cf['log'] ) {
    logger.add(new winston.transports.File(cf['log']));
    logger.debug(`Logging to file: ${JSON.stringify(cf['log'])}`);
  }


  const indexer = new CatalogSolr(logger, cf['debug']);

  if( !indexer.setConfig(cf['fields']) ) {
    return;
  }

  const solrUpdate = cf['solrBase'] + '/update/json';

  const solrUp = await checkSolr(cf['solrBase'] + '/admin/ping', cf['retries'], cf['retryInterval']);

  if( solrUp ) {
    if( cf['purge'] ) {
      await purgeSolr(solrUpdate);
    }

    if( cf['updateSchema'] ) {
      const schema = await buildSchema(cf);
      if( schema ) {
        await updateSchema(cf['solrBase'] + '/schema', schema);
      } else {
        return;
      }
    }

    const records = await loadFromOcfl(cf['ocfl'], cf['catalogFilename'], cf['hashAlgorithm']);

    const solrDocs = await indexRecords(
      indexer, cf['dump'], cf['uriIds'], cf['ocfl'], records
    );

    for( const doc of solrDocs ) {
      try {
        await updateDocs(solrUpdate, [ doc ]);
        await commitDocs(solrUpdate, '?commit=true&overwrite=true');
        logger.debug(`Indexed ${doc['record_type_s']} ${doc['id']}`);
      } catch(e) {
        logger.error("Update failed: " + e);
        if( e.response ) {
          logger.error(e.response.status);
        }      
      }
    }
    // TODO; write out the facets config 
    // from indexer.facets() (or keep that logic in this script rather than the library)


  } else {
    logger.error("Couldn't connect to Solr");
  }
}





async function checkSolr(solrPing, retries, retryInterval) {
  for( let i = 0; i < retries; i++ ) {
    logger.info(`Pinging Solr ${solrPing} - attempt ${i + 1} of ${retries}`)  
    try {
      const response = await axios({
        url: solrPing,
        method: 'get',
        responseType: 'json'
      });
      if( response.status == 200 ) {
        if( response.data['status'] === 'OK' ) {
          logger.info("Solr is up!");
          return true;
        }
      }
    } catch(e) {
      logger.info(`Solr ping failed`);
    }
    await sleep(retryInterval);
  }
  logger.info(`Maximum connection attempts ${retries}`);
  return false;
}









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


async function buildSchema(cf) {
  try {
    const schema = await fs.readJson(cf['schemaBase']);
    logger.silly(`Building Solr schema on ${cf['schemaBase']}`);
    schema['copyfield'] = [];
    for( let ms_field of cf['fields']['main_search'] ) {
      schema['copyfield'].push({
        "source": ms_field,
        "dest": [ "main_search" ]
      });
    }
    return schema;
  } catch(e) {
    logger.error(`Error building Solr schema: ${e}`);
    return null;
  }
}




async function updateSchema(solrURL, schemaConf) {

  for( const type of Object.keys(schemaConf) ) {
    for( const field of schemaConf[type] ) {
      logger.silly(`Setting schema field ${type} ${JSON.stringify(field)}`);
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
    logger.silly(`Schema: deleting copyfield ${JSON.stringify(schemaJson)}`);
    await tryDeleteCopyField(solrURL, schemaJson);
    schemaAPIJson['add-copy-field'] = schemaJson;
  } else {
    const apifield = ( fieldtype === 'field' ) ? 'field' : 'dynamic-field';
    if( await schemaFieldExists(url, name) ) {
      logger.silly(`Schema: replacing ${fieldtype} ${name}`);
      schemaAPIJson['replace-' + apifield] = schemaJson;
    } else {    
      logger.silly(`Schema: adding ${fieldtype} ${name}`);
      schemaAPIJson['add-' + apifield] = schemaJson;
    }
  }

  try {
    logger.silly(`Posting to schema API ${url} ${JSON.stringify(schemaAPIJson)}`);
    const response = await axios({
      url: solrURL,
      method: 'post',
      data: schemaAPIJson,
      responseType: 'json',
      headers: {
      'Content-Type': 'application/json; charset=utf-8'
      }
    });
  } catch(e) {
    logger.error("Error updating schema");
    logger.error(`URL: ${url}`);
    logger.silly(`schemaAPIJson: ${JSON.stringify(schemaAPIJson)}`);
    if( e.response ) {
      logger.error(`${e.response.status} ${e.response.statusText}`);
    } else {
      logger.error(e);
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
    logger.silly("Schema field " + field + " already exists");
    return true;
  } catch(e) {
    if( e.response.status === 404 ) {
      logger.error("Schema field " + field + " not found");
      return false;
    } else {
      logger.error("unknown error " + e);
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
    logger.silly("copyfield removed");
    return true;
  } catch(e) {
    if( e.response ) {
      if( e.response.status === 404 ) {
        logger.error("Schema field " + field + " not found");
        return false;
      } else {
        logger.error("copy field delete error " + e.response.status);
        return false;
      }
    } else { 
      logger.error("unknown error " + e);
      throw(e);
      return false;
    } 
  }
}




async function purgeSolr(solrUpdate) {

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
    logger.info("All solr documents deleted.");
    return true
  } catch(e) {
    if( e.response ) {
      logger.error("Solr error");

      logger.error(e.response.status);
      return false;
    } else {
      log.error("General error");
      log.error(e);
      process.exit(-1);
    }
  }
}





async function loadFromOcfl(repoPath, catalogFilename, hashAlgorithm) {
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
      }
    }
  }
  return records;
  
}


async function dumpDocs(dumpDir, jsonld, solrDocs) {
  const id = jsonld['hash_path'];
  const jsonDump = path.join(dumpDir, `${id}.json`);
  logger.silly(`Dumping solr ${jsonDump}`);
  await fs.writeJson(jsonDump, solrDocs, { spaces: 2});
}


// making this async so that the indexer can do async operations like
// load a payload file for full-text search 


async function indexRecords(indexer, dumpDir, uriIds, ocflPath, records) {

  const solrDocs = [];
  for( record of records ) {
    try {
      const jsonld = record['jsonld'];
      const docs = await indexer.createSolrDocument(record['jsonld'], async (fpath) => {
        const relpath = await record['ocflObject'].getFilePath(fpath);
        return path.join(ocflPath, record['path'], relpath);
      });
      if (docs) {
        if( dumpDir ) {
          await dumpDocs(dumpDir, record, docs);
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
                  logger.error("Couldn't find id for uri_id");
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
      logger.error(`Error creating solr doc from ${record['path']}`);
      logger.error(e);
    }

  }
  indexer = null;
  return solrDocs;
}



// this is a basic version which loops through the record, indexes and commits
// them one at a time, so a single bad record won't prevent an entire indexing
// run



// async function indexRecords(indexer, dumpDir, ocflPath, records) {
//   const solrDocs = await solrObjects(indexer, dumpDir, ocflPath, records);

//   for( const doc of solrDocs ) {
//     try {
//       await updateDocs(solrUpdate, [ doc ]);
//       await commitDocs(solrUpdate, '?commit=true&overwrite=true');
//       logger.info(`Indexed ${doc['record_type_s']} ${doc['id']}`);
//     } catch(e) {
//       logger.error("Update failed: " + e);
//       if( e.response ) {
//         logger.error(e.response.status);
//       }      
//     }
//   }
// }





