
const expect = require('chai').expect;
const _ = require('lodash');
const randomWord = require('random-word');
const CatalogSolr = require('../lib/CatalogSolr');

const REPEATS = 10000;

// tests for the item filtering code - which we should probably roll back
// into ro-crate itself


function randomGraph(n, type, fields) {
  return Array(n).fill(null).map(() => {
    const item = { '@type': type };
    _.each(fields, (field) => item[field] = randomWord());
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




describe('single filters', function () {
  this.timeout(5000);
  it('can pick items by exact matching a single field', function () {
    _.times(REPEATS, () => {
      const graph = randomGraph(100, 'Dataset', ['path']);
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
      const graph = randomGraph(100, 'Dataset', ['path']);
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





// Given a list of fields, and an item with a value for each of those
// fields, returns a random filter over two or more of those fields, 
// with a mix of regexps and exact matches, which is guaranteed to
// match the item

function randomFilter(fields, item) {
  const n = _.random(2, fields.length);
  const ffields =_.sampleSize(fields, n);
  const filter = {};
  _.each(ffields, (ff) => {
    if( _.random(1) === 0 ) {
      filter[ff] = item[ff]
    } else {
      filter[ff] = { re: randomSubstring(item[ff]) }
    }
  });
  return filter;
}

describe('multiple filters', function () {
  this.timeout(5000);

  it('can pick items by multiple filters', function () {
     _.times(REPEATS, () => {
      const fields = [ 'path', 'name', 'description', 'id', 'colour', 'weight' ];
      const graph = randomGraph(100, 'Dataset', fields);
      const item = _.sample(graph);
      const filterspec = randomFilter(fields, item);
      const catalog = makeCatalog(filterspec);
      const matches = graph.filter(catalog.filters['Dataset']);
      expect(matches).to.be.an('array').and.to.not.be.empty;
      const res = {};
      // precompile the regexps for checking the results
      _.each(filterspec, (filter, field) => {
        if( typeof filter === 'object') {
          res[field] = new RegExp(filter['re']);
        }
      });

      _.each(matches, (match) => {
        _.each(filterspec, ( filter, field ) => {
          if( typeof filter === 'object' ) {
            expect(match).to.have.property(field).match(res[field])
          } else {
            expect(match).to.have.property(field, filter);
          }
        })
      });
    });
  });
});
