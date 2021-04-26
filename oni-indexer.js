#!/usr/bin/env node


const axios = require('axios');
const _ = require('lodash');
const ROCrateIndexer = require('./lib/ROCrateIndexer');
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

const DEFAULT_CONFIG = './config.json';

const DEFAULTS = {
  'schemaBase': './config/schema_base.json',
  'retries': 10,
  'retryInterval': 10,
  'catalogFilename': 'ro-crate-metadata.jsonld',
  'uriIds': 'hashpaths',
  'updateSchema': true,
  'hashAlgorithm': 'md5',
  'logLevel': 'warn',
  'timeout': 180
};

var argv = require('yargs')
    .usage('Usage: $0 [options]')
    .describe('c', 'Config file')
    .alias('c', 'config')
    .default('c', DEFAULT_CONFIG)
    .alias('i', 'item')
    .describe('i', 'Index a single item')
    .string('i')
    .help('h')
    .alias('h', 'help')
    .describe('p', 'Purge')
    .alias('p', 'purge')
    .boolean('p')
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


  const indexer = new ROCrateIndexer(logger, cf['debug']);

  if( !indexer.setConfig(cf['fields']) ) {
    return;
  }

  const solrUpdate = cf['solrBase'] + '/update/json';

  const solrUp = await checkSolr(cf['solrBase'] + '/admin/ping', cf['retries'], cf['retryInterval']);

  if( solrUp ) {
    if(!_.isUndefined(argv.p)) {
      cf['purge'] = argv.p;
    }
    if( cf['purge'] ) {
      logger.info("Purging all records from solr");
      await purgeSolr(solrUpdate);
    }

    if( cf['updateSchema'] ) {
      logger.info("Updating solr schema");
      const schema = await buildSchema(cf);
      if( schema ) {
        await updateSchema(cf['solrBase'] + '/schema', schema);
      } else {
        return;
      }
    }

    logger.info(`Loading repo ${cf['ocfl']}`);

    const records = await loadFromOcfl(cf['ocfl'], cf['catalogFilename'], cf['hashAlgorithm']);

    if( cf['limit'] ) {
      logger.warn(`only indexing first ${cf['limit']} items`);
    }


    let count = 0;

    logger.info(`loaded ${records.length} records from ocfl`);

    for( const record of records ) {
      logger.warn(`Indexing ${record['path']}`);
      const solrDocs = await indexRecords(
          indexer, cf['dump'], cf['uriIds'], cf['ocfl'], [ record ]
      );

      logger.info(`Got ${solrDocs.length} solr docs`);
      if( solrDocs.length < 1 ) {
        logger.error(`Warning: ${record['id']} returned no solr docs`);
      }
      for( let doc of solrDocs ) {
        try {
          if(! doc['id'] ) {
            logger.error('Document without an id - skipping');
          } else {
            let skipped = false;
            if( cf['skip'] ) {
              if( cf['skip'].includes(doc['id'][0]) ) {
                logger.warn(`Skipping ${doc['id']} from cf.skip`);
                skipped = true;
              }
            }
            if( !skipped ) {
              logger.info(`Updating ${doc['record_type_s']} ${doc['id']}`);
              await updateDocs(solrUpdate, [ doc ], cf);
              logger.info(`Committing ${doc['record_type_s']} ${doc['id']}`);
              await commitDocs(solrUpdate, '?commit=true&overwrite=true', cf);
              logger.debug(`Indexed ${doc['record_type_s']} ${doc['id']}`);
              if( cf['waitInterval'] ) {
                logger.debug(`waiting ${cf['waitInterval']}`);
                await sleep(cf['waitInterval']);
              }
            }
          }
        } catch(e) {
          logger.error(`Update failed for ${doc['id']}: ` + e);
          if( cf['dump'] ) {
            const cleanid = doc['id'][0].replace(/[^a-zA-Z0-9_]/g, '_');
            const dumpfn = path.join(cf['dump'], cleanid + '_error.json');

            await fs.writeJson(dumpfn, doc, { spaces: 2});
            logger.error(`Wrote solr doc to ${dumpfn}`);
          }
          if( e.response ) {
            logger.error("Solr request failed with status " + e.response.status);
            const error = e.response.data.error;
            if( error ) {
              logger.error(error['msg']);
              logger.error(error['metadata']);
              if( error['trace'] ) {
                logger.error(error['trace'].substr(0,40));
              }
            } else {
              logger.error("No error object in response");
              logger.error(JSON.stringify(e.response.data));
            }
          } else {
            logger.error("Request failed");
            logger.error(e.message);
          }
        }
      }
      count++;
      logger.info(`Sent ${count} documents of ${records.length} to Solr`);
      if( cf['limit'] && count > cf['limit'] ) {
        break;
      }
    }

  } else {
    logger.error("Couldn't connect to Solr");
  }
}





async function checkSolr(solrPing, retries, retryInterval) {
  for( let i = 0; i < retries; i++ ) {
    logger.debug(`Pinging Solr ${solrPing} - attempt ${i + 1} of ${retries}`)
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
      logger.debug("Waiting for Solr to start");
    }
    await sleep(retryInterval);
  }
  logger.error(`Couldn't connect to Solr after ${retries} connection attempts`);
  return false;
}









function commitDocs(solrURL, args, cf) {
  return axios({
    url: solrURL + args,
    method: 'get',
    responseType: 'json',
    timeout: cf['timeout'] * 1000,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

function updateDocs(solrURL, coreObjects, cf) {
  return axios({
    url: solrURL + '/docs',
    method: 'post',
    data: coreObjects,
    responseType: 'json',
    timeout: cf['timeout'] * 1000,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });
}


async function buildSchema(cf) {
  try {
    const schema = await fs.readJson(cf['schemaBase']);
    logger.debug(`Building Solr schema on ${cf['schemaBase']}`);
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
      logger.debug(`Setting schema field ${type} ${JSON.stringify(field)}`);
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
    logger.debug(`Schema: deleting copyfield ${JSON.stringify(schemaJson)}`);
    await tryDeleteCopyField(solrURL, schemaJson);
    schemaAPIJson['add-copy-field'] = schemaJson;
  } else {
    const apifield = ( fieldtype === 'field' ) ? 'field' : 'dynamic-field';
    if( await schemaFieldExists(url, name) ) {
      logger.debug(`Schema: replacing ${fieldtype} ${name}`);
      schemaAPIJson['replace-' + apifield] = schemaJson;
    } else {
      logger.debug(`Schema: adding ${fieldtype} ${name}`);
      schemaAPIJson['add-' + apifield] = schemaJson;
    }
  }

  try {
    logger.debug(`Posting to schema API ${url} ${JSON.stringify(schemaAPIJson)}`);
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
    logger.info(`schemaAPIJson: ${JSON.stringify(schemaAPIJson)}`);
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
    logger.debug("Schema field " + field + " already exists");
    return true;
  } catch(e) {
    if( e.response.status === 404 ) {
      logger.debug("Schema field " + field + " not found");
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
    logger.debug("copyfield removed");
    return true;
  } catch(e) {
    if( e.response ) {
      if( e.response.status === 404 ) {
        logger.error("Schema field " + field + " not found");
        return false;
      }
      if( e.response.status === 400 ) {
        // we assume that a bad request indicates that we were trying to
        // delete a copyfield which hadn't been defined yet, which isn't
        // an error
        logger.info("copy field returned 400 - this usually isn't an error");
        return true;
      }
    } else {
      logger.error("unknown error " + e);
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
  const catalogs = Array.isArray(catalogFilename) ? catalogFilename : [ catalogFilename ];

  for ( let object of objects ) {
    logger.info(`Loading ocfl object at ${object.path}`);
    const json = await readCrate(object, catalogFilename);
    if( json ) {
      records.push({
        path: path.relative(repoPath, object.path),
        hash_path: hasha(object.path, { algorithm: hashAlgorithm }),
        jsonld: json,
        ocflObject: object
      });
    } else {
      logger.warn(`Couldn't find ${catalogFilename} in OCFL inventory for ${object.path}`);
    }
  }

  logger.info(`got ${records.length} records`);

  return records;
}


// look for the ro-crate metadata file in the ocfl object's
// inventory, and if found, try to load and parse it.
// if it's not found, returns undefined

async function readCrate(object, catalogFilename) {

  const inv = await object.getInventory();
  var headState = inv.versions[inv.head].state;

  for (let hash of Object.keys(headState)){
    if (headState[hash].includes(catalogFilename)) {
      const jsonfile = path.join(object.path, inv.manifest[hash][0]);
      try {
        const json = await fs.readJson(jsonfile);
        return json;
      } catch(e) {
        logger.error(`Error reading ${jsonfile}`);
        logger.error(e);
        return undefined;
      }
    }
  }
  return undefined;
}


async function dumpDocs(dumpDir, jsonld, solrDocs) {
  const id = jsonld['hash_path'];
  const jsonDump = path.join(dumpDir, `${id}.json`);
  logger.debug(`Dumping solr ${jsonDump}`);
  await fs.writeJson(jsonDump, solrDocs, { spaces: 2});
}



async function indexRecords(indexer, dumpDir, uriIds, ocflPath, records) {

  const solrDocs = [];
  for( record of records ) {
    logger.info(`Indexing record ${record['path']}`);
    try {
      const jsonld = record['jsonld'];
      const docs = await indexer.createSolrDocument(record['jsonld'], async (fpath) => {
            const relpath = await record['ocflObject'].getFilePath(fpath);
            return path.join(ocflPath, record['path'], relpath);
          },
          record['hash_path']
      );
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
      logger.error(`Indexing error ${record['path']}: ${e}`);
      logger.debug(`Stack trace ${e.stack}`);
    }

  }
  indexer = null;
  return solrDocs;
}

// take the facets which have been configured for the index and
// write out a version which the frontend/portal can use

async function makePortalFacets(cf, facets) {
  const portal = cf['portal'];

  const newFacets = {};

  for( let type in facets ) {
    for( let field in facets[type] ) {
      const facetField = facets[type][field]['facetField'];
      if( portal['facetDefaults'] ) {
        newFacets[facetField] = _.cloneDeep(portal['facetDefaults']);
      } else {
        newFacets[facetField] = {};
      };
      newFacets[facetField]['field'] = field;
      newFacets[facetField]['label'] = field[0].toUpperCase() + field.substr(1);
    }
  }

  let portalcf = await readConf(portal['config']);

  if( portalcf ) {
    logger.info(`Updating facets in existing portal config ${portal['config']}`);
  } else {
    logger.info(`Creating new portal config based on ${portal['base']}`);
    portalcf = await fs.readJson(portal['base']);
  }

  for( let oldFacet in portalcf['facets'] ) {
    if( ! newFacets[oldFacet] ) {
      logger.info(`Removing facet ${oldFacet}`);
      delete portalcf['facets'][oldFacet];
      _.remove(portalcf['results']['resultFacets'], (f) => f === oldFacet);
      _.remove(portalcf['results']['searchFacets'], (f) => f === oldFacet);
    } else {
      portalcf['facets'][oldFacet]['field'] = newFacets[oldFacet]['field'];
      // update the JSON selector fields
      // keep the rest of the config (sort order, limit, etc)
      delete newFacets[oldFacet];
    }
  }

  // Add facets which weren't in the original facet lst.
  // These always get added to the search and result facet list.

  for( let newFacet in newFacets ) {
    logger.info(`Adding facet ${newFacet}`);
    portalcf['facets'][newFacet] = newFacets[newFacet];
    portalcf['results']['searchFacets'].push(newFacet);
    portalcf['results']['resultFacets'].push(newFacet);
  }


  await fs.writeJson(portal['config'], portalcf, { spaces:2 });

  logger.info(`Wrote new portal config to ${portal['config']}`);

}



async function readConf(portalcf) {
  try {
    const conf = await fs.readJson(portalcf);
    return conf;
  } catch(e) {
    logger.info(`Portal conf ${portalcf} not found`);
    return null;
  }
}