
const expect = require('chai').expect;
const _ = require('lodash');
const randomWord = require('random-word');
const CatalogSolr = require('../lib/CatalogSolr');
const ROCrate = require('ro-crate').ROCrate;


// tests for license remapping

const PREFIXES = {
  cc: 'https://creativecommons.org',
  uts: 'https://research.uts'
};

function makeLicenseCf(hasDefault) {
  const lcf = {};
  _.each(PREFIXES, ( prefix, key ) => {
    lcf["^" + prefix] = key;
  });
  if( hasDefault ) {
    lcf['__default__'] = 'private';
  }
  return lcf;
}


function makeIndexer(hasDefault) {
  const catalog = new CatalogSolr();
  
  catalog.setConfig({
    licenses: makeLicenseCf(hasDefault),
    types: {
      Dataset: {
        "license": { "multi": true }
      }
    }
  });

  return catalog;
}

// returns a stub graph with a root dataset with the list of
// raw licenses

function makeGraph(licenses) {
  return {
    '@context': 'https://raw.githubusercontent.com/ResearchObject/ro-crate/master/docs/0.3-DRAFT/context.json',
    '@graph': [
      {
        '@type': 'Dataset', 
        'license': licenses,
        '@id': './',
        'name': 'root',
        'description': 'root'
      },
      {
        "@type": "CreativeWork",
        "@id": "ro-crate-metadata.jsonld",
        "identifier": "ro-crate-metadata.jsonld",
        "about": {
          "@id": "./"
        }
      }
    ]
  };
}

function getDataset(solrDocs) {
  const matches = solrDocs['Dataset'].filter((doc) => doc['@id'][0] === './');
  if( matches.length === 1 ) {
    return matches[0];
  } else {
    return undefined;
  }
}



describe('mapping licenses', function () {

  it('gives the default license to a crate with no license', function () {
    const indexer = makeIndexer(true);

    const jsonld = makeGraph([]);
    const solrDocs = indexer.createSolrDocument(jsonld);

    const solrDoc = getDataset(solrDocs);

    expect(solrDoc).to.not.be.undefined;
    expect(solrDoc).to.have.property('license');
    expect(solrDoc['license']).to.eql([ 'private' ]);

  });

  it('maps a crate with one known license', function () {
    const indexer = makeIndexer(true);

    const jsonld = makeGraph([ PREFIXES['uts'] + '/' + randomWord() ]);
    const solrDocs = indexer.createSolrDocument(jsonld);

    const solrDoc = getDataset(solrDocs);

    expect(solrDoc).to.not.be.undefined;
    expect(solrDoc).to.have.property('license');
    expect(solrDoc['license']).to.eql(['uts' ]);

  });



  it.skip('maps a crate with two known licenses', function () {
    const indexer = makeIndexer(true);

    const jsonld = makeGraph([ PREFIXES['uts'] + '/' + randomWord(), PREFIXES['cc'] + '/' + randomWord() ]);
    const solrDocs = indexer.createSolrDocument(jsonld);

    console.log(JSON.stringify(solrDocs));

    const solrDoc = getDataset(solrDocs);

    expect(solrDoc).to.not.be.undefined;
    expect(solrDoc).to.have.property('license');
    expect(solrDoc['license']).to.have.members([ 'cc', 'uts' ]);

  });



});



