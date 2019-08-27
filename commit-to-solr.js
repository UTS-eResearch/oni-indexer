const axios = require('axios');
const _ = require('lodash');
const yargs = require('yargs');
const CatalogSolr = require('./lib/CatalogSolr');
const ROCrate = require('ro-crate').ROCrate;
const fs = require('fs-extra');
const path = require('path');
const OCFLRepository = require('ocfl').Repository;
const uuidv1 = require('uuid/v1');
const hasha = require('hasha');


const argv = yargs['argv'];
const configPath = argv.config || './config.json';

if (!fs.existsSync(configPath)) {
  console.error(`Please provide a valid config file path: ${configPath}`);
  process.exit(1);
}

const configJson = fs.readJsonSync(configPath);
const solrUpdate = configJson['solrUpdate'] || '';
const fieldConfig = fs.readJsonSync(configJson['fields']);
const logLevel = configJson['logLevel'] || 4;
const waitPeriod = configJson['waitPeriod'] || 0;
const batchNum = configJson['batch'] || 1000;
const catalogFilename = configJson['catalogFilename'] || 'CATALOG.json';
const hashAlgorithm = configJson['hashAlgorithm'] || 'md5';      
const sourcePath = configJson['ocfl'];

const dryRun = configJson['dryRun'] || false;

const sleep = ms => new Promise((r, j) => {
  console.log('Waiting for ' + ms + ' seconds');
  setTimeout(r, ms * 1000);
});

function commitDocs(solrURL, URI) {
  return axios({
    url: solrURL + URI,
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


async function loadFromOcfl(repoPath, hash_algorithm) {
  const repo = new OCFLRepository();

  await repo.load(repoPath);

  const objects = await repo.objects();
  const records = [];
  for ( const oid of  Object.keys(objects)) {
    const object = objects[oid];
    const inv = await object.getInventory();
    var headState = inv.versions[inv.head].state;
    for (let hash of Object.keys(headState)){
      if (headState[hash].includes(catalogFilename)) {
        const jsonfile = path.join(object.path, inv.manifest[hash][0]);
        const json = await fs.readJson(jsonfile);
        records.push({
          path: object.path,
          uri_id: hasha(object.path, { algorithm: hashAlgorithm }),
          jsonld: json
        });
      }
    }
  }
  return records;
  
}



// 


function solrObjects(recs) {
  let indexer = new CatalogSolr();
  indexer.setConfig(fieldConfig);
  const solrDocs = [];
  recs.forEach((record) => {
    try {
      const jsonld = record['jsonld'];
      const docs = indexer.createSolrDocument(jsonld);
      if (docs) {
        if (docs.Dataset) {
          docs.Dataset.forEach((dataset) => {
            dataset['path'] = record['path'];
            dataset['uri_id'] = record['uri_id'];
            solrDocs.push(dataset);
            console.log(`Dataset URI id ${dataset['uri_id']}`);
          });
        }
        if (docs.Person) {
          docs.Person.forEach((person) => {
            solrDocs.push(person);
          });
        }
      }
    } catch(e) {
      console.log("Error converting ro-crate to solr");
      console.log(e);
      console.log(JSON.stringify(jsonld).substr(0, 160));
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
      dumpSolrSync(solrDocs);
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
      console.log(String(e));
      //fs.writeFileSync(path.join('test-data', 'error.log'), e);
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
  const records = await loadFromOcfl(sourcePath);

  console.log("Got " + records.length + " records from " + sourcePath);
  
  await commitBatches(records);
}

  

main();



