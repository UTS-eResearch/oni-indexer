const assert = require('assert');
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

    assert.strictEqual(solrObject['Dataset'][0]['record_format_s'], 'Dataset','Dataset not loaded');
  });
});