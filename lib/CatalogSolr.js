const _ = require('lodash');
const assert = require('assert');
const ROCrate = require('ro-crate').ROCrate;
const Utils = require('ro-crate').Utils;

// rewrote createSolrObject and getGraphElement so that they use the
// new ro-crate library and are not recursive







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



  validateConfig() {
    // Dont you hate not knowing what the configuration needs?
    _.each(this.config['types'], function (config, type) {
      assert.strictEqual(_.isObject(config['facets']), true, `missing facets in configuration for ${type}`);
      assert.strictEqual(_.isObject(config['flatten']), true, `missing facets in configuration for ${type}`);
    });
    return true;
  }

  enforceSolrFieldNames(k) {
    const k1 = k.replace('https?://schema.org/', '');
    return k1.replace(/[^a-zA-Z\d_]/, '_');
  }

  ensureObjArray(graphElement) {
    _.forOwn(graphElement, (ge, prop) => {
      if (!_.isArray(ge)) {
        graphElement[prop] = [ge];
      }
    });
    return graphElement;
  }

  findFacetObject(graph, obj, name, value, facetInfo) {

    let key = '';
    // TODO: send _Dataset (core) prefix from function
    if (facetInfo['field_suffix']) {
      if (facetInfo['tokenize']) {
        value = value.split(facetInfo['tokenize']['delim']);
      }
      if (facetInfo['fieldName']) {
        //find each value by id
        const ids = [];
        _.each(obj, (o) => ids.push(o['@id']));
        const values = _.filter(graph, (g) => {
          return _.find(g['@id'], (gg) => {
            return _.find(ids, (id) => gg === id)
          });
        });
        value = [];
        _.each(values, (v) => _.each(v[facetInfo['fieldName']], (vv) => value.push(vv)));
        const valueStringify = JSON.stringify(values);
        key = name + facetInfo['field_suffix'];
        return [{key: key, value: value}, {key: name, value: valueStringify}];
      } else {
        key = name + facetInfo['field_suffix'];
        return {key: key, value: value}
      }
    } else {
      key = name + facetInfo['field_suffix'];
    }
    return {
      key: key,
      value: value
    }

  }

  // config - the fields.json item for this type (Dataset, Person)
  // graph - the entire graph
  // graphEle - the Dataset/Person etc which we are indexing

  getGraphElement(config, graph, graphEle) {
    console.log(`gGE -  type ${graphEle['@type']} id ${graphEle['@id']} name id ${graphEle['name']}`);
    const base = {};
    console.log("Looping through graphEle");
    _.forOwn(graphEle, (gg, kk) => {
      console.log(JSON.stringify([ gg, kk ]));
      if (config.skip && _.find(config.skip, (s) => s === kk)) {
      } else {
        if (_.isObject(gg) && !_.isArray(gg)) {
          //TODO: make this efficient
          const found = _.find(graph, (ge) => {
            return gg['@id'] === ge['@id'];
          });
          if (found) {
            base[kk] = this.getGraphElement(config, graph, found);
          }
        } else if (_.isArray(gg)) {
          _.each(gg, (ggg, kkk) => {
            const facetInfo = _.find(config.facets, (facet, facetKey) => {
              return facetKey === kk;
            });
            if (facetInfo) {
              const facetObject = this.findFacetObject(graph, gg, kk, ggg, facetInfo);
              if (Array.isArray(facetObject)) {
                facetObject.forEach((fO) => {
                  base[fO['key']] = fO['value'];
                });
              } else {
                base[facetObject['key']] = facetObject['value'];
              }
            }
            if (kk === '@type') { //TODO handle this by config!
              base.record_type_s = ggg;
              base.record_format_s = ggg;
              base.type_label = ggg;
              base.type_facetmulti = ggg;
              //with key value === @type get the config
              config = this.config[ggg] || config;
            } else if (kk === '@id') {
              base.id = ggg;
              base.id_orig = ggg;
            } else if (_.isObject(ggg)) {

              //TODO: make this efficient! It's nuts!
              const found = _.find(graph, (ge) => {
                return _.find(ge, (gee) => {
                  return _.find(gee, (geee) => geee === ggg['@id']);
                });
              });
              if (found) {
                if (config.flatten && config.flatten[kk]) {
                  const objFound = this.getGraphElement(config, graph, found);
                  if (config.flatten[kk]['obj'] === 'array') {
                    if (Array.isArray(base[kk])) {
                      base[kk].push(JSON.stringify(objFound).replace(/"/g, '\''));
                    } else {
                      base[kk] = [JSON.stringify(objFound).replace(/"/g, '\'')];
                    }
                  } else {
                    base[kk] = JSON.stringify(objFound).replace(/"/g, '\'')
                  }
                } else {
                  base[kk] = this.getGraphElement(config, graph, found);
                }
              }
            } else {
              base[kk] = ggg;
            }
          });
        }
      }
    });

    return base;

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


  createSolrObject(jsonld, rootConfig) {

    //Peter's idea is to convert everything into an array then it is safer to work to convert
    const graph = _.each(jsonld[rootConfig], (g) => {
      return this.ensureObjArray(g);
    });

    const solrObject = {};
    _.each(this.config, (field, type) => {
      let graphElement = _.filter(graph, (g) => {
        return _.find(g['@type'], (gg) => gg === type) ? g : undefined;
      });
      if (graphElement) {
        _.each(graphElement, (ge) => {
          if (Array.isArray(solrObject[type])) {
            solrObject[type].push(this.getGraphElement(this.config[type], graph, ge));
          } else {
            solrObject[type] = [this.getGraphElement(this.config[type], graph, ge)];
          }
        });
      }
    });

    return solrObject;
  }
}

module.exports = CatalogSolr;