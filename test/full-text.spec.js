const assert = require('assert');
const expect = require('chai').expect;
const _ = require('lodash');
const path = require('path');
const fs = require('fs-extra');
const CatalogSolr = require('../lib/CatalogSolr');
const rocrate = require('ro-crate');

async function initIndexer(configFile) {
  const cf = await fs.readJson(configFile);
  const indexer = new CatalogSolr();
  indexer.setConfig(cf);
  return indexer;
}


// TODO: have this actually test a dataset and some people

describe('full text search', function () {
  const test_data = path.join(process.cwd(), 'test-data');
  const cf_file = path.join(test_data, 'fields-full-text.json');

  it('indexes the full text of a file in an ro-crate', async function () {
    const ca = await fs.readJson(path.join(test_data, 'successful-grant-example.jsonld'));
    const indexer = await initIndexer(cf_file);

    const solrObject = indexer.createSolrDocument(ca, '@graph');

    expect(solrObject).to.have.property('File');

  });



});