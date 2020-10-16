const assert = require('assert');
const expect = require('chai').expect;
const _ = require('lodash');
const path = require('path');
const fs = require('fs-extra');
const CatalogSolr = require('../lib/CatalogSolr');
const rocrate = require('ro-crate');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.simple(),
  transports: [
    new winston.transports.Console()
  ]
});

async function initIndexer(configFile) {
  const cf = await fs.readJson(configFile);
  const indexer = new CatalogSolr(logger);
  indexer.setConfig(cf['fields']);
  return indexer;
}



describe('indexing values with item resolution', function () {
  this.timeout(0);
  const test_data = path.join(process.cwd(), 'test-data', 'criminals');

  it('can index the criminal characters dataset', async function () {
    const cf = path.join(test_data, 'indexer.json');
    const ca = await fs.readJson(path.join(test_data, 'ro-crate-metadata.json'));
    const indexer = await initIndexer(cf);

    const solrDocs = await indexer.createSolrDocument(ca, '@graph');
    expect(solrDocs['Person']).to.not.be.empty;
    const persons = solrDocs['Person'];



    const testCasesFile = await fs.readFile(path.join(test_data, "testCases.json"));
    const testCases = JSON.parse(testCasesFile);

    // note: the members of the solr doc objects returned by createSolrDocument
    // are weird JS objects which look like single-element arrays when 
    // stringified, which is what the [0] in the filter is for. This is bad
    // and needs fixing.

    await fs.writeJson(path.join(test_data, "doc_dump.json"), solrDocs, {'spaces': 2});

    // for( let id in testCases ) {
    //   const testCase = testCases[id]
    //   const solrDoc = persons.filter((d) => { return d['id'][0] === id });
    //   expect(solrDoc).to.not.be.empty;
    //   const bp = solrDoc[0]['birthPlace'];
    //   console.log(`birthplace matches ${bp} = ${testCase['birthPlace']}`);
    //   expect(bp).to.equal(testCase['birthPlace']);
    // }



  });


// #person__VICFP_18551934_1_573

});
