const _ = require('lodash');
const assert = require('assert');
const ROCrate = require('ro-crate').ROCrate;
const Utils = require('ro-crate').Utils;

class CatalogSolr {

  constructor() {
  }

  setConfig(config) {
    this.config = config;
    this.filters = {};

    _.each(this.config['types'], ( typecf, type ) => {
      const typef = {};
      _.each(typecf, ( fieldcf, field ) => {
        if( 'filter' in fieldcf ) {
          typef[field] = fieldcf['filter'];
        }
      });
      this.filters[type] = this.compileFilter(typef);
    });
  }

  // build a filter function from the config for an item type

  compileFilter(cf) {
    //console.log(`cf: ${JSON.stringify(cf)}`);
    const fs = [];
    //console.log(`Compiling filter ${JSON.stringify(cf, null, 2)}`);
    _.each(cf, ( condition, field ) => {
      if( typeof condition === 'object' ) {
        if( condition['re'] ) {
          const re = new RegExp(condition['re']);
          const f = this.makeMatcher(field, re);
          fs.push(f);
        } else {
          console.error("Unknown filter type in " + JSON.stringify(condition) );
        }
      } else {
        const f = this.makeMatcher(field, condition);
        fs.push(f);
      }
    })
    // match only if every predicate is true
    return (item) => _.every(fs, (f) => f(item));
  }

  // Builds a closure which matches against an item's value for field if
  // - the value is a string which matches
  // - the value is an array containing at least one string which matches
  // the target param can be a RegExp or a string

  makeMatcher(field, target) {
    var match;
    if ( typeof target === 'string' ) {
      match = (v) => {
        //console.log(`matching '${v}' against '${target}'`);
        return ( v === target);
      };
    } else {
      match = (v) => {
        //console.log(`matching '${v}' against /${target}/`);
        //console.log(typeof v);
        //console.log(`v = ${JSON.stringify(v)}`);
        return v.match(target);
      };
    }
    return ( item ) => {
      if( field in item ) {
        const value = item[field];
        if( Array.isArray(value) ) {
          return _.some(value, match);
        } else {
          return match(value);
        } 
      }
      return false;
    }
  }




  createSolrDocument(jsonld) {
    const crate = new ROCrate(jsonld);
    crate.index();

    const cfMap = this.config['map_all'];
    const cfTypes = this.config['types'];
    const solrDocument = {};

    // loop through each item in the JSON-LD @graph

    for ( const item of crate.graph ) {
      const type = item['@type'];
      if( type in cfTypes ) {
        // get config for this type of item
        const cf = cfTypes[item['@type']];

        // test if item passes the filters (compiled when the config was loaded)

        if( this.filters[type](item) ) {
          // start with the fields which have configured mappings for all items
          const solr = this.baseSolr(cfMap, item);

          _.each(item, ( value, field ) => {
            const fieldcf = cf[field];
            if( !(field in cfMap) ) {
              if( ! fieldcf ) {
                // no config for this field so copy
                solr[field] = this.unwrap(value);
              } else {
                if( ! fieldcf['skip'] ) {
                  // resolve lookups
                  if( fieldcf['resolve'] ) {
                    solr[field] = this.resolveValues(crate, fieldcf['resolve'], value);
                  } else {
                    solr[field] = this.unwrap(value);
                  }
                  // make facets - these can be based on raw or resolved values depending
                  // on the faceting rule, so pass both in
                  if( fieldcf['facet'] ) {
                    const facet = this.makeFacet(crate, fieldcf['facet'], value, solr[field]);
                    const facetField = [ type, field, Array.isArray(facet) ? 'facetmulti' : 'facet'].join('_');
                    console.log(`FACET ${facetField} ${JSON.stringify(facet)}`);
                    solr[facetField] = facet;
                  }
                }
              }
            }
          });
          if( !(type in solrDocument) ) {
            solrDocument[type] = [];
          }
          solrDocument[type].push(solr)
        }
      }
    }

    return solrDocument;

  }


  resolveValues(crate, cf, value) {
    if( cf === 'multi' ) {
      return value.map((v) => this.resolveAndFlatten(crate, v));
    } else {
      if( Array.isArray(value) ) {
        return this.resolveAndFlatten(crate, value[0]);
      } else {
        return this.resolveAndFlatten(crate, value);
      }
    }
  }


  resolveAndFlatten(crate, value) {
    if( !('@id' in value ) ) {
      return this.convertError(`no @id found in value ${JSON.stringify(value)}`);
    }
    const resolved = crate.getItem(value['@id']);
    if( !resolved ) {
      return this.convertError(`@id ${value['@id']} not found`);
    }
    return JSON.stringify(resolved).replace(/"/g, '\'');    
  }

  // returns

  makeFacet(crate, cf, raw, resolved) {

    if( cf['tokenize'] ) {
      if( raw ) {
        return raw.split(cf['tokenize']['delim']);
      } else {
        return [];
      }
    }
    if (cf['fieldName']) {
      if( Array.array(raw) ) {
        return raw.map((v) => {
          const lookup = crate.getItem(v['@id']);
          if( lookup ) {
            return lookup[cf['field']]
          } else {
            return v['@id'];
          }
        });
      } else {
        return [];
      }
    }
    // by default, use the resolved and flattened value(s)
    return resolved;
  }



  // TODO - this should give better context

  convertError(message) {
    const wrapped = `Conversion error: ${message}`;
    console.log(wrapped);
    return wrapped;
  }



  

  // mappings which are done for all solr records

  baseSolr(map_all, item) {
    const base = {};
    _.each(map_all, ( targets, field ) => {
      _.each(targets, ( target ) => {
        base[target] = this.unwrap(item[field])
      });
    });
    return base;
  }


  // unwrap a value if it's in an array

  unwrap(value) {
    if( Array.isArray(value) ) {
      return value[0];
    } else {
      return value;
    }
  }


}

module.exports = CatalogSolr;