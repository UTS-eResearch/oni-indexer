const axios = require('axios');
const _ = require('lodash');
const yargs = require('yargs');
const CatalogSolr = require('./lib/CatalogSolr');
const fs = require('fs-extra');
const path = require('path');

const argv = yargs['argv'];
const configPath = argv.config || './config.json';
if (!fs.existsSync(configPath)) {
  console.error(`Please provide a valid config file path: ${configPath}`);
  process.exit(1);
}

const configJson = require(configPath);
const sourcePath = _.endsWith(configJson['source'], '/') ? configJson['source'] : `${configJson['source']}/`;
const solrUpdate = configJson['solrUpdate'] || '';
const fieldConfig = require(configJson['fields']);
const logLevel = configJson['logLevel'] || 4;
const waitPeriod = configJson['waitPeriod'] || 0;
const batchNum = configJson['batch'] || 1000;

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
    const solrObj = catalog.createSolrObject(record, '@graph');
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
  });
  catalog = null;
  return catalogs;
}

// MAIN APP

let dirs = null;
if (fs.existsSync(sourcePath)) {
  dirs = fs.readdirSync(sourcePath).filter(f => fs.statSync(path.join(sourcePath, f)).isDirectory());
} else {
  console.error(`Source path doesn't exist: ${sourcePath}`);
  process.exit(1);
}

const batch = _.chunk(dirs, batchNum);
dirs = null;

batch.reduce((promise, p, index) => {
  return promise.then(() => {
    if (logLevel >= 4) console.log(`Using: ${Math.round(process.memoryUsage().rss / 1024 / 1024 * 100) / 100} MBs`);
    const records = jsonRecords(sourcePath, p);
    const catalogs = solrObjects(records);
    return updateDocs(solrUpdate, catalogs).then(async () => {
      if (waitPeriod) {
        const waited = await sleep(waitPeriod);
      }
      console.log(`batch ${index} of ${batch.length} : Update docs`);
      if (index >= batch.length - 1) {
        console.log('run commit');
        return commitDocs(solrUpdate, '?commit=true&overwrite=true').then(() => {
          return Promise.resolve();
        });
      }
      return Promise.resolve();
    });
  }).catch((e) => {
    console.log(e);
  })
}, Promise.resolve());


