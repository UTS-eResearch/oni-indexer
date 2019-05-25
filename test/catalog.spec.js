const assert = require('assert');
const _ = require('lodash');
const path = require('path');
const fs = require('fs-extra');
const randomize = require('datacrate/lib/randomize');
const CatalogSolr = require('../lib/CatalogSolr');

let sourcedata = {};
let datapubs = [];
const datacrateDirPath = path.join(process.cwd(), './test-data/datacrates');
const fieldsPath = path.join(process.cwd(), '/test-data/', 'fields.json');


before(async () => {
  fs.ensureDirSync(datacrateDirPath);
  sourcedata = await randomize.loadsourcedata('./node_modules/datacrate/vocabularies');
});

let catalogjson = null;

describe('get random datcrates', function () {
  it('randomize 1 datacrate', async function () {
    datapubs = randomize.randdatapubs(1, sourcedata);
    const id = await randomize.makedir(datacrateDirPath);
    return randomize.makedatacrate(datacrateDirPath, datapubs[0], id).then(() => {
      catalogjson = require(path.join(datacrateDirPath, id, 'CATALOG.json'));
      assert.notStrictEqual(catalogjson['@graph'], undefined, 'datacrate not created');
    });
  });
});

describe('catalog', function () {
  let catalog = {};

  before(function () {
    catalog = new CatalogSolr(catalogjson);
  });

  describe('catalog', function () {
    it('should load catalog', function () {
      assert.strictEqual(_.isObject(catalog.jsonld['@context']), true, 'catalog not loaded')
    });
  });

  describe('load special fields', function () {
    it('should get special fields', function () {
      const fields = require(fieldsPath);
      const isConfig = catalog.setConfig(fields);
      assert.strictEqual(isConfig, true, 'Config not complete');
    });
  });

  describe('graph', function () {
    it('should load the graph into a dataset', function () {

      const caPath = path.join(process.cwd() + '/test-data', 'CATALOG.json');
      const ca = require(caPath);

      const fieldConfig = catalog.config;

      //TODO: Peter's idea is to convert everything into an array then it is safer to work to convert
      const graph = _.each(ca['@graph'], (g) => {
        return catalog.ensureObjArray(g);
      });

      let graphElement = _.find(graph, (g) => {
        return _.find(g['@type'], (gg) => gg === 'Dataset') ? g : undefined;
      });

      const dataset = catalog.getGraphElement(fieldConfig['dataset'], graph, graphElement);

      assert.strictEqual(dataset.record_type_s, 'dataset', 'Dataset not loaded');
    });
  });

})
;

after(() => {
  fs.remove(datacrateDirPath);
});


