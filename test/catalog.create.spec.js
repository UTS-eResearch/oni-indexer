const assert = require('assert');
const _ = require('lodash');
const path = require('path');
const fs = require('fs-extra');
const randomize = require('../lib/randomize');
const CatalogSolr = require('../lib/CatalogSolr');
const winston = require('winston');

const logger = winston.createLogger({
  format: winston.format.simple(),
  transports: [
    new winston.transports.Console()
  ]
});


let sourcedata = {};
let datapubs = [];

const rocrateDirPath = path.join(process.cwd(), './test-data/rocrates');
const fieldsPath = path.join(process.cwd(), '/test-data/', 'fields.json');


before(async () => {
  await fs.ensureDir(rocrateDirPath);
  sourcedata = await randomize.loadsourcedata('./vocabularies');
});

let catalogjson = null;

describe('create random ro-crates', function () {
  it('randomize 1 rocrate', async function () {
    datapubs = randomize.randdatapubs(1, sourcedata);
    const id = await randomize.makedir(rocrateDirPath);
    await randomize.makerocrate(rocrateDirPath, datapubs[0], id);
    catalogjson = await fs.readJson(path.join(rocrateDirPath, id, 'ro-crate-metadata.jsonld'));
    assert.notStrictEqual(catalogjson['@graph'], undefined, 'ro-crate not created');
  });
});

// I don't want to rewrite these now (ML 2-10-2020)

describe.skip('catalog', function () {
  let catalog = {};

  before(function () {
    catalog = new CatalogSolr(logger);
  });

  describe('load config fields', function () {
    it('should get config fields', function () {
      const fields = require(fieldsPath);
      const isConfig = catalog.setConfig(fields);
      assert.strictEqual(isConfig, true, 'Config not complete');
    });
  });

  describe('graph - dataset', function () {
    it('should load the graph into a dataset', function () {

      const caPath = path.join(process.cwd() + '/test-data', 'CATALOG.json');
      const ca = require(caPath);

      const fieldConfig = catalog.config;

      let graphElement = _.find(graph, (g) => {
        return _.find(g['@type'], (gg) => gg === 'Dataset') ? g : undefined;
      });

      const dataset = catalog.getGraphElement(fieldConfig['Dataset'], graph, graphElement);

      assert.strictEqual(dataset.record_type_s, 'Dataset', 'Dataset not loaded');
    });
  });

  describe('graph - person', function () {
    it('should load the graph into a Person', function () {

      const caPath = path.join(process.cwd() + '/test-data', 'CATALOG.json');
      const ca = require(caPath);

      const fieldConfig = catalog.config;

      let graphElement = _.find(graph, (g) => {
        return _.find(g['@type'], (gg) => gg === 'Person') ? g : undefined;
      });

      const person = catalog.getGraphElement(fieldConfig['Person'], graph, graphElement);

      assert.strictEqual(person.record_type_s, 'Person', 'Person not loaded');
    });
  });

  describe('graph - catalog solr', function () {
    it('should load the graph into a catalog solr array', function () {

      const caPath = path.join(process.cwd() + '/test-data', 'CATALOG.json');
      const ca = require(caPath);

      const fieldConfig = catalog.config;

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

      assert.strictEqual(catalogSolr.Dataset[0].record_type_s, 'Dataset', 'dataset not loaded');
      assert.strictEqual(catalogSolr.Person[0].record_type_s, 'Person', 'person 1 not loaded');
      assert.strictEqual(catalogSolr.Person[3].record_type_s, 'Person', 'person 1 not loaded');

    });
  });

  describe('farm to freeways graph - catalog solr', function () {
    it('should load the graph into a catalog solr array', function () {

      const caPath = path.join(process.cwd() + '/test-data', 'FARMTOFREEWAYS_CATALOG.json');
      const ca = require(caPath);

      const fieldConfig = catalog.config;

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

      assert.strictEqual(catalogSolr.Dataset[0].record_type_s, 'Dataset', 'dataset not loaded');
      assert.strictEqual(catalogSolr.Person[0].record_type_s, 'Person', 'person 1 not loaded');
      assert.strictEqual(catalogSolr.Person[3].record_type_s, 'Person', 'person 1 not loaded');

    });
  });

});

after(() => {
  //fs.remove(rocrateDirPath);
});


