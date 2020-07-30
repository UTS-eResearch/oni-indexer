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
      records.length = cf['limit'];
    }

    logger.info(`Got ${records.length} ro-crates`);

    logger.info("Indexing");

    const solrDocs = await indexRecords(
      indexer, cf['dump'], cf['uriIds'], cf['ocfl'], records
    );

    logger.info(`Committing ${solrDocs.length} solr docs`);

    for( const doc of solrDocs ) {
      try {
        await updateDocs(solrUpdate, [ doc ]);
        await commitDocs(solrUpdate, '?commit=true&overwrite=true');
        logger.info(`Indexed ${doc['record_type_s']} ${doc['id']}`);
      } catch(e) {
        logger.error(`Solr update failed for ${doc['record_type_s']} ${doc['id']}`);
        logger.error(e);
        if( e.response ) {
          logger.error(e.response.status);
        }      
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
      logger.silly(`Still waiting for solr`);
    }
    await sleep(retryInterval);
  }
  logger.error(`Couldn't connect to Solr after ${retries} connection attempts`);
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
    logger.debug(`schemaAPIJson: ${JSON.stringify(schemaAPIJson)}`);
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
  const catalogs = Array.isArray(catalogFilename) ? catalogFilename : [ catalogFilename ];

  for ( let object of objects ) {
    const inv = await object.getInventory();
    const headState = inv.versions[inv.head].state;
    var json = null;
    for (let hash of Object.keys(headState)) {
      for( let cfile of catalogs ) {
        if (headState[hash].includes(cfile)) {
          const jsonfile = path.join(object.path, inv.manifest[hash][0]);
          json = await fs.readJson(jsonfile);
          break;
        }
      } 
    }
    if( json ) {
      const p = path.relative(repoPath, object.path);
      const pid = p.replace(/\//g, ''); 
      records.push({
        path: path.relative(repoPath, object.path),
        hash_path: pid,
        jsonld: json,
        ocflObject: object
      });
      logger.info(`Loaded ocfl object ${object.path}`);
    } else {
      logger.error(`Couldn't find ${catalogFilename} in ${object.path}`);
    }
  }
  return records;
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


