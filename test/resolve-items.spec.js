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


const TESTDIR = path.join(process.cwd(), 'test-data', 'criminals');

const TESTCF = path.join(TESTDIR, 'indexer.json');
const TESTJSON = path.join(TESTDIR, 'ro-crate-metadata.json');

async function testResolveCase(testType) {
  const cf = await fs.readJson(TESTCF);
  const indexer = new CatalogSolr(logger);
  indexer.setConfig(cf['fields']);
  const dataset = await fs.readJson(TESTJSON);
  const solrDocs = await indexer.createSolrDocument(dataset, '@graph');

  expect(solrDocs['Person']).to.not.be.empty;
  const persons = solrDocs['Person'];

  const testCasesFile = await fs.readFile(path.join(TESTDIR, "testCases.json"));
  const testCases = JSON.parse(testCasesFile);

  for( let id in testCases ) {
    const testCase = testCases[id]
    const solrDoc = persons.filter((d) => { return d['id'][0] === id });
    expect(solrDoc).to.not.be.empty;
    const bp = solrDoc[0][testType];
    expect(testCase[testType]).to.not.be.empty;
    expect(bp).to.equal(testCase[testType]);
  }
}



describe('indexing values with item resolution', function () {
  this.timeout(0);

  it.skip('can resolve single lookups', async function () {
    await testResolveCase('birthPlace');
  });


  it('can resolve multi-step lookups', async function () {
    await testResolveCase('convictions');
  });


  it.skip('can resolve reverse lookups', async function () {
    await testResolveCase('reverse_convictions');
  });



});
