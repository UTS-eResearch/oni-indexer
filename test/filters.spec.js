
const expect = require('chai').expect;
const _ = require('lodash');
const randomWord = require('random-word');
const CatalogSolr = require('../lib/CatalogSolr');

const REPEATS = 100;

// tests for the item filtering code - which we should probably roll back
// into ro-crate itself


function randomGraph(n, type, field) {
  return Array(n).fill(null).map(() => {
    const item = { '@type': type };
    item[field] = randomWord();
    return item;
  });
}

function makeCatalog(spec) {
  const catalog = new CatalogSolr();
  
  catalog.setConfig({
    types: {
      Dataset: {
        filter: spec
      }
    }
  });

  return catalog;
}


function randomSubstring(word) {
  const start = _.random(0, word.length - 2);
  const len = _.random(1, word.length - start);
  return word.substr(start, len);
}


describe('item filtering', function () {

  it('can pick items by exact matching a single field', function () {
    _.times(REPEATS, () => {
      const graph = randomGraph(100, 'Dataset', 'path');
      const item = _.sample(graph);
      const lookfor = item['path'];
      const catalog = makeCatalog({path: lookfor});
      const matches = graph.filter(catalog.filters['Dataset']);
      expect(matches).to.be.an('array').and.to.not.be.empty;
      _.each(matches, (match) => {
        expect(match).to.have.property('path', lookfor)
      });
    });
  });

  it('can pick items by regexps on a single field', function () {
    _.times(REPEATS, () => {
      const graph = randomGraph(100, 'Dataset', 'path');
      const item = _.sample(graph);
      const lookfor = randomSubstring(item['path']);
      const catalog = makeCatalog({path: { re: lookfor } } );
      const matches = graph.filter(catalog.filters['Dataset']);
      expect(matches).to.be.an('array').and.to.not.be.empty;
      const lookfor_re = new RegExp(lookfor);
      _.each(matches, (match) => {
        expect(match).to.have.property('path').match(lookfor_re)
      });
    });
  });


});
