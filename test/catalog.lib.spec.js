const assert = require('assert');
const _ = require('lodash');
const path = require('path');
const fs = require('fs-extra');
const CatalogSolr = require('../lib/CatalogSolr');
const expect = require('chai').expect;

function jsonRecord(basePath, fileName) {
  try {
    const entryPath = path.join(basePath, fileName);
    if (fs.existsSync(entryPath)) {
      let entryJson = fs.readFileSync(entryPath).toString();
      return JSON.parse(entryJson);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(-1);
  }
}

describe('create solr object', function () {
  const fieldsPath = path.join(process.cwd(), 'test-data', 'fields.json');
  let catalog = new CatalogSolr();
  const fields = require(fieldsPath);
  catalog.setConfig(fields);

  it('should use library to create a solr object', function () {
    const ca = jsonRecord(process.cwd(), path.join('test-data', 'vic-arch-ro-crate-metadata.jsonld'));

    const solrDoc = catalog.createSolrDocument(ca, '@graph');

    expect(solrDoc['Dataset'][0]['record_type_s'][0]).to.equal('Dataset')

  });
});