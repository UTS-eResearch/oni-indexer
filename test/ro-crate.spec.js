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

describe('converting ro-crates to solr documents', function () {
  const test_data = path.join(process.cwd(), 'test-data');
  const cf_file = path.join(test_data, 'fields.json');

  it('converts an RO-crate to a solr document with facets', async function () {
    const ca = await fs.readJson(path.join(test_data, 'vic-arch-ro-crate-metadata.jsonld'));
    const indexer = await initIndexer(cf_file);

    const solrObject = indexer.createSolrDocument(ca, '@graph');

    expect(solrObject['Dataset'][0]['record_type_s'][0]).to.equal('Dataset');
    const dsSolr = solrObject['Dataset'][0];
    expect(dsSolr).to.have.property("Dataset_publisher_facet");
    expect(dsSolr).to.have.property("Dataset_datePublished_facet");
  });


  it('indexes FOR codes', async function () {
    const jsonld = await fs.readJson(path.join(test_data, 'FOR-codes-ro-crate-metadata.jsonld'));
    const indexer = await initIndexer(cf_file);

    const crate = new rocrate.ROCrate(jsonld);
    crate.index();

    const root = crate.getRootDataset();

    // get a list of the FOR ids from the original ro-crate
    const orig_fors = root['about'].map((i) => i['@id']).filter((i) => i.match(/anzsrc-for/));

    const solrObject = indexer.createSolrDocument(jsonld, '@graph');

    expect(solrObject['Dataset'][0]['record_type_s'][0]).to.equal('Dataset');
    const dsSolr = solrObject['Dataset'][0];

    expect(dsSolr).to.have.property("Dataset_about_facetmulti");
    expect(dsSolr).to.have.property("about");
    const for_index = JSON.parse('[' + dsSolr['about'] + ']');
    expect(for_index).to.be.an('array');
    expect(for_index).to.have.lengthOf(orig_fors.length);

  });
});
