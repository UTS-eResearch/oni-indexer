const assert = require('assert');
const expect = require('chai').expect;
const _ = require('lodash');
const path = require('path');
const fs = require('fs-extra');
const CatalogSolr = require('../lib/CatalogSolr');


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

// TODO: have this actually test a dataset and some people

describe('create solr object', function () {
  const test_data = path.join(process.cwd(), 'test-data');
  const fieldsPath = path.join(test_data, 'fields.json');

  let catalog = new CatalogSolr();
  const fields = require(fieldsPath);
  catalog.setConfig(fields);

  it('should use library to create a solr object', function () {
    const ca = jsonRecord(test_data, 'FARMTOFREEWAYS_CATALOG.json');

    const solrObject = catalog.createSolrDocument(ca, '@graph');

    fs.writeFileSync(path.join(test_data, "solr_output.json"), JSON.stringify(solrObject, null, 2));

    expect(solrObject['Dataset'][0]['record_type_s']).to.equal('Dataset');
  });
});