const axios = require('axios');
const _ = require('lodash');
const yargs = require('yargs');
const CatalogSolr = require('./lib/CatalogSolr');
const fs = require('fs-extra');

const argv = yargs['argv'];
const configPath = argv.config || './config.json';
if (!fs.existsSync(configPath)) {
  console.error(`Please provide a valid config file path: ${configPath}`);
  process.exit(1);
}
const configJson = require(configPath);
const sourcePath = _.endsWith(configJson.source, '/') ? configJson.source : `${configJson.source}/`;
const solrUpdate = configJson['solrUpdate'] || '';
const fieldConfig = require(configJson['fields']);
const logLevel = configJson['logLevel'] || 4;
const waitPeriod = configJson['waitPeriod'] || 0;

const catalog = new CatalogSolr();
catalog.setConfig(fieldConfig);

const sleep = ms => new Promise((r, j) => {
  console.log('Waiting for ' + ms + ' seconds');
  setTimeout(r, ms * 1000);
});

function commitDocs(URI) {
  return axios({
    url: solrUpdate + URI,
    method: 'get',
    responseType: 'json',
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

function updateDocs(coreObjects) {
  return axios({
    url: solrUpdate + '/docs',
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

function createCatalogSolr(ca) {
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

let records = [];
if (fs.existsSync(sourcePath)) {
  records = recordsArray(sourcePath);
} else {
  console.error(`Source path doesn't exist: ${sourcePath}`);
  process.exit(1);
}

catalogs = [];

records.forEach((r) => {
  const solrObj = createCatalogSolr(r);
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

const fakePromises = [1];

fakePromises.reduce((promise, p, index) => {
  return promise.then(() => {
    return updateDocs(catalogs).then(async () => {
      if (waitPeriod) {
        const waited = await sleep(waitPeriod);
      }
      console.log('Update docs');
      if (index >= fakePromises.length - 1) {
        console.log('run commit');
        return commitDocs('?commit=true&overwrite=true').then(() => {
          return Promise.resolve();
        });
      }
      return Promise.resolve();
    });
  }).catch((e) => {
    console.log(e);
  })
}, Promise.resolve());