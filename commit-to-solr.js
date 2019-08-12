const axios = require('axios');
const _ = require('lodash');
const yargs = require('yargs');
const CatalogSolr = require('./lib/CatalogSolr');
const ROCrate = require('ro-crate').ROCrate;
const fs = require('fs-extra');
const path = require('path');
const OCFLRepository = require('ocfl').Repository;
const uuidv1 = require('uuid/v1');


const argv = yargs['argv'];
const configPath = argv.config || './config.json';

if (!fs.existsSync(configPath)) {
  console.error(`Please provide a valid config file path: ${configPath}`);
  process.exit(1);
}

const configJson = require(configPath);
const solrUpdate = configJson['solrUpdate'] || '';
const fieldConfig = require(configJson['fields']);
const logLevel = configJson['logLevel'] || 4;
const waitPeriod = configJson['waitPeriod'] || 0;
const batchNum = configJson['batch'] || 1000;
const catalogFilename = configJson['catalogFilename'] || 'CATALOG.json';
      
const sourcePath = _.endsWith(configJson['source'], '/') ? configJson['source'] : `${configJson['source']}/`;

const ocflMode = configJson['ocfl'] || false;
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

// needs to be replaced because OCFL 

function jsonRecords(basePath, dirs) {
  const records = [];
  _.each(dirs, (d) => {
    const entryPath = path.join(basePath, `${d}/CATALOG.json`);
    if (fs.existsSync(entryPath)) {
      let entryJson = fs.readFileSync(entryPath).toString();
      entryJson = JSON.parse(entryJson);
      records.push(entryJson);
      entryJson = null;
    }
  });
  return records;
}


function solrObjects(recs) {
  let catalog = new CatalogSolr();
  catalog.setConfig(fieldConfig);
  const catalogs = [];
  recs.forEach((record) => {
    try {
      const solrObj = catalog.createSolrDocument(record);
      if (solrObj) {
        if (solrObj.Dataset) {
          solrObj.Dataset.forEach((c) => {
            catalogs.push(c);
          });
        }
        if (solrObj.Person) {
          solrObj.Person.forEach((c) => {
            catalogs.push(c);
          });
        }
      }
    } catch(e) {
      console.log("Error converting ro-crate to solr");
      console.log(e);
      console.log(JSON.stringify(record).substr(0, 160));
    }

  });
  catalog = null;
  return catalogs;
}



async function loadFromDirs(root) {
  const e = await fs.stat(root);
  if( !e ) {
    console.error(`Source path doesn't exist: ${sourcePath}`);
    process.exit(1);
  } else {
    console.log(e);
  }

  const paths = await fs.readdir(sourcePath);
  const dirs = [];

  for( const p of paths ) {
    var s = await fs.stat(p);
    if( s.isDirectory() ) {
      dirs.push(p);
    }
  }
  return dirs;
}




async function loadFromOcfl(repoPath) {
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
        records.push(json);
      }
    }
  }
  return records;
  
}





async function commitBatches (records) {
  console.log("updating " + records.length + " records");
  const batch = _.chunk(records, batchNum);

  batch.reduce((promise, records, index) => {
    return promise.then(() => {
      if (logLevel >= 4) {
        reportMemUsage();
      }
      const catalogs = solrObjects(records);
      dumpSolrSync(catalogs);
      if( dryRun ) {
        console.log("Dry-run mode, not committing");
        return Promise.resolve();
      }
      return updateDocs(solrUpdate, catalogs).then(async () => {
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
  var records = null;
  if( ocflMode ) {
    records = await loadFromOcfl(sourcePath);
  } else {
    records = await loadFromDirs(sourcePath);
  }

  console.log("Got " + records.length + " records from " + sourcePath);
  
  await commitBatches(records);
}

  

main();



