const assert = require('assert');
const expect = require('chai').expect;
const _ = require('lodash');
const path = require('path');
const fs = require('fs-extra');
const CatalogSolr = require('../lib/CatalogSolr');


async function initIndexer(configFile) {
  const cf = await fs.readJson(configFile);
  const indexer = new CatalogSolr();
  indexer.setConfig(cf);
  return indexer;
}


// TODO: have this actually test a dataset and some people

describe('create solr object', function () {
  const test_data = path.join(process.cwd(), 'test-data');
  const cf_file = path.join(test_data, 'fields.json');

  it('converts an RO-crate to a solr document with facets', async function () {
    const ca = await fs.readJson(path.join(test_data, 'vic-arch-ro-crate-metadata.jsonld'));
    const indexer = await initIndexer(cf_file);

    const solrObject = indexer.createSolrDocument(ca, '@graph');

    fs.writeFileSync(path.join(test_data, "solr_output.json"), JSON.stringify(solrObject, null, 2));

    expect(solrObject['Dataset'][0]['record_type_s'][0]).to.equal('Dataset');
    const dsSolr = solrObject['Dataset'][0];
    expect(dsSolr).to.have.property("Dataset_publisher_facet");
    expect(dsSolr).to.have.property("Dataset_datePublished_facet");
  });
});


// describe('indexes a RO-Crate with FOR codes', function () {
//   const roc = 


// })