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

function recordsArray(sourcePath) {
  const records = [];
  _.each(fs.readdirSync(sourcePath, {encoding: 'utf-8', withFileTypes: true}), (dirEnt) => {
    // fs.dirEnt needs node version 10 +
    if (dirEnt.isDirectory()) {
      const entryPath = `${sourcePath}${dirEnt.name}/CATALOG.json`;
      if (fs.existsSync(entryPath)) {
        const entryJson = require(entryPath);
        records.push(entryJson);
        if (logLevel >= 4) console.log(`Added: ${entryPath}`);
      } else {
        console.error(`CATALOG.json missing: ${entryPath}`);
      }
    } else {
      if (logLevel >= 4) console.log(`Ignoring, not a directory: ${dirEnt.name}`);
    }
  });
  return records;
}

function entries(basePath, dirs) {
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

function createCatalogSolr(catalog, ca) {

  //Peter's idea is to convert everything into an array then it is safer to work to convert
  const graph = _.each(ca['@graph'], (g) => {
    return catalog.ensureObjArray(g);
  });

  const catalogSolr = {};
  _.each(fieldConfig, (field, name) => {
    let graphElement = _.filter(graph, (g) => {
      return _.find(g['@type'], (gg) => gg === name) ? g : undefined;
    });
    if (graphElement) {
      _.each(graphElement, (ge) => {
        if (Array.isArray(catalogSolr[name])) {
          catalogSolr[name].push(catalog.getGraphElement(fieldConfig[name], graph, ge));
        } else {
          catalogSolr[name] = [catalog.getGraphElement(fieldConfig[name], graph, ge)];
        }
      });
    }
  });

  return catalogSolr;
}

function catalogToArray(recs) {
  let catalog = new CatalogSolr();
  catalog.setConfig(fieldConfig);
  const catalogs = [];
  recs.forEach((rec) => {
    const solrObj = createCatalogSolr(catalog, rec);
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

function batchIt(b) {
  b.map(async (p, index) => {
    try {
      if (logLevel >= 4) console.log(`Using: ${Math.round(process.memoryUsage().rss / 1024 / 1024 * 100) / 100} MBs`);
      records = entries(sourcePath, p);
      catalogs = catalogToArray(records);
      records = null;
      let update = await updateDocs(solrUpdate, catalogs);
      catalogs = null;
      p = null;
      console.log(`batch ${index} of ${batch.length} : Update docs`);
      if (waitPeriod) {
        const waited = await sleep(waitPeriod);
      }
    } catch (e) {
      console.log(e);
    }
  });
  commitDocs(solrUpdate, '?commit=true&overwrite=true').then(() => {
    console.log('solr commit');
    return Promise.resolve();
  }).catch((err) => {
    return Promise.reject(err);
  });
}

function reduceIt(b){
  b.reduce((promise, p, index) => {
    return promise.then(() => {
      if (logLevel >= 4) console.log(`Using: ${Math.round(process.memoryUsage().rss / 1024 / 1024 * 100) / 100} MBs`);
      const records = entries(sourcePath, p);
      const catalogs = catalogToArray(records);
      return updateDocs(solrUpdate, catalogs).then(async () => {
        if (waitPeriod) {
          const waited = await sleep(waitPeriod);
        }
        console.log(`batch ${index} of ${batch.length} : Update docs`);
        if (index >= b.length - 1) {
          console.log('run commit');
          return commitDocs(solrUpdate,'?commit=true&overwrite=true').then(() => {
            return Promise.resolve();
          });
        }
        return Promise.resolve();
      });
    }).catch((e) => {
      console.log(e);
    })
  }, Promise.resolve());
}

let dirs = null;
if (fs.existsSync(sourcePath)) {
  dirs = fs.readdirSync(sourcePath).filter(f => fs.statSync(path.join(sourcePath, f)).isDirectory());
} else {
  console.error(`Source path doesn't exist: ${sourcePath}`);
  process.exit(1);
}

const batch = _.chunk(dirs, batchNum);
dirs = null;
let records = [];
let catalogs = [];

//batchIt(batch);
reduceIt(batch);

if (logLevel >= 4) console.log(`Using: ${Math.round(process.memoryUsage().rss / 1024 / 1024 * 100) / 100} MBs`);

