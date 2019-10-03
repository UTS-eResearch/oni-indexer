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
    this.root = undefined;

    _.each(this.config['types'], ( typecf, type ) => {
      const typef = {};
      _.each(typecf, ( fieldcf, field ) => {
        if( 'filter' in fieldcf ) {
          typef[field] = fieldcf['filter'];
        }
      });
      this.filters[type] = this.compileFilter(typef);
    });

    this.licenses = this.compileLicense();
  }

  // build a filter function from the config for an item type

  compileFilter(cf) {
    const fs = [];
    _.each(cf, ( condition, field ) => {
      if( typeof condition === 'object' ) {
        if( condition['re'] ) {
          const re = new RegExp(condition['re']);
          const f = this.makeMatcher(field, re);
          fs.push(f);
        } else if ( condition['is_root'] ) {
          fs.push((item) => {
            if( this.root ) {
              return this.root['@id'] === item['@id'];
            } else {
              return false;
            }
          })
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
        return ( v === target);
      };
    } else {
      match = (v) => {
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


  // precompile the licence regexps as a method, mapLicenses, which takes
  // a raw license list and returns a list of mapped licenses, or the
  // default license, or an empty list if there's no config

 

  compileLicense(dataset) {
    const lCf = this.config['licenses'];
    if( ! lCf ) {
      this.mapLicenses = (raw) => { return [] };
      return;
    }
    this.licenseRes = [];
    _.each(lCf, (value, re) => {
      if( re !== '__default__' ) {
        this.licenseRes.push({re: new RegExp(re), value: value});
      }
    });

    this.mapLicenses = (ls) => {
      const mapped = [];
      _.each(ls, (l) => {
        _.each(this.licenseRes, (lre) => {
          if(l['@id']){
            l = l['@id'];
          }
          if( l.match(lre['re']) ) {
            mapped.push(lre['value']);
          } else {
            console.log("no license match");
          }
        })
      });
      const umapped = _.uniq(mapped)
      if( umapped.length === 0 ) {
        if( lCf['__default__'] ) {
          return [ lCf['__default__'] ];
        } else {
          return [];
        }
      } else {
        return umapped;
      }
    };
  }




  createSolrDocument(jsonld) {
    const crate = new ROCrate(jsonld);
    this.crate = crate;
    // Keep track of things that are resolved and have index config (ignoring filter)
    this.resolvedItemsToIndex = {};

    crate.index();

    const cfBase = this.config['map_all'] || {};
    const cfTypes = this.config['types'];

    // do the root Dataset item first

    const datasetCf = cfTypes['Dataset'];

    if(! datasetCf) {
      throw Error("ro-crate to solr config must have a Dataset type");
    }

    this.root = crate.getRootDataset();
    if( !this.root ) {
      throw Error("Couldn't find ro-crate's root dataset");
    }
    // clone the item and rewrite its @id to a named identifier if
    // that's been configured
    const rootItem = _.clone(this.root);
    const rootOrigId = rootItem['@id']; // so we can skip it later

    if( datasetCf['@id'] ) {
      const namespace = datasetCf['@id']['name'];
      const identifier = crate.getNamedIdentifier(namespace);
      if( identifier ) {
        rootItem['@id'] = identifier;
      } else {
        throw Error("Couldn't find named identifier " + namespace)
      }
    }

    rootItem['license'] = this.mapLicenses(rootItem['license']);
    const rootSolr = this.mapItem(cfBase, datasetCf, crate, 'Dataset', rootItem);
    const solrDocument = { 'Dataset': [ rootSolr ] };

    // TODO INHERET LICENCE IF ITEM DOES NOT HAVE ONE
    // |||||||
    // VVVVVVV

    // loop through each item in the JSON-LD @graph
    for ( const item of crate.graph ) {
      if( item['@id'] !== rootOrigId ) {
        var types = this.crate.utils.asArray(item['@type']);
        // Look through types in order 
        for (let type of Object.keys(cfTypes)) {
          if( types.includes(type) ) {
            // get config for this type of item
            const cf = cfTypes[type];
            if(this.resolvedItemsToIndex[item["@id"]] || this.filters[type](item) ) {
              // Only do ONCE per type
              types = [type];
              item["@type"] = types;
              const solr = this.mapItem(cfBase, cf, crate, type, item)
              if( !(type in solrDocument) ) {
                solrDocument[type] = [];
              }
              solrDocument[type].push(solr)
            }
          }
       }
      }
    }

    return solrDocument;

  }



  // map the fields in an an ro-crate item to a solr document

  mapItem(cfBase, cf, crate, type, item) {
    const solr = this.baseSolr(cfBase, item);
    _.each(item, ( value, field ) => {
      const fieldcf = cf[field];
      if( !(field in cfBase ) ) {
        if( ! fieldcf ) {
          // no config for this field so copy
          solr[field] = this.unwrap(value);
        } else {
          if( ! fieldcf['skip'] ) {
            // resolve lookups
            if( fieldcf['resolve'] ) {
              solr[field] = this.resolveValues(crate, fieldcf['resolve'], value);
              const vals = this.crate.utils.asArray(solr[field]);
              solr[`${field}_id`] =  [];
              for (let val of vals) {
                try {
                  const value = JSON.parse(val);
                  solr[`${field}_id`].push(value["@id"]);
                }
                catch (e) {
                  console.log("ERROR", e.message, val)
                }
              }
            } else {
              if( fieldcf['multi'] ) {
                console.log("Multi", fieldcf)
                solr[field] = this.unwrap(value, fieldcf.escapedJSON);
              } else {
                solr[field] = this.unwrap(value);
              }
            }
            if( fieldcf['validate'] ) {
              const type = fieldcf['validate'];
              solr[field] = this.validate(type, solr[field]);
              // TODO add year
            }
            // make facets - these can be based on raw or resolved values depending
            // on the faceting rule, so pass both in
            if( fieldcf['facet'] ) {
              const facet = this.makeFacet(crate, fieldcf['facet'], value, solr[field]);
              const facetField = [ type, field, Array.isArray(facet) ? 'facetmulti' : 'facet'].join('_');
              solr[facetField] = facet;
            }
          }
        }
      }
    });
    return solr;
  }



  resolveValues(crate, cf, value) {
    if( typeof value !== 'object' ) {
      return value;
      const error = this.convertError(`Can't resolve '${value}'`);
      return ( cf === 'multi' ) ? [ error ] : error;
    }
    if( cf === 'multi' ) {
      if( Array.isArray(value) ) {
        return value.map((v) => this.resolveAndFlatten(crate, v));
      } else {
        return [ this.resolveAndFlatten(crate, value) ];
      }
    } else {
      if( Array.isArray(value) ) { 
        return this.resolveAndFlatten(crate, value[0]);
      } else {
        return this.resolveAndFlatten(crate, value);
      }
    }
  }


  resolveAndFlatten(crate, value, solr) {
    if( !('@id' in value ) ) {
      return value;
      return this.convertError(`no @id found in value ${JSON.stringify(value)}`);
    }
    const resolved = crate.getItem(value['@id']);
    if( !resolved ) {
      return this.convertError(`@id ${value['@id']} not found`);
    }
    
    const resolvedTypes = this.crate.utils.asArray((resolved["@type"]));
    for (let type of Object.keys(this.config['types'])) {
      const cf = this.config['type'];
      if (resolvedTypes.includes(type)) {
        this.resolvedItemsToIndex[resolved["@id"]] = true;
      }
    }

    return JSON.stringify(resolved).replace(/"/g, '\"');    
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

  // primitive normalisation/validation, just to weed out bad dates at this stage

  validate(type, values) {
    if( type === 'date' ) {
        for (let value of values ){
        value = value.replace(/[^\d-]+/, "");
        if( value.match(/^(\d\d\d\d)(-\d\d-\d\d?$)?/) ) {
          return value;
        }
        console.log(`Date ${value} did not match`);
        this.convertError(`Invalid ${type}: ${value}`);
        return '';
      }
      this.convertError(`Unknown validation type ${type}`);
    }
  }


  // TODO - this should give better context

  convertError(message) {
    const wrapped = `[ERROR]: ${message}`;
    console.log(this.rootId + ' ' + wrapped);
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

  unwrap(value, returnJson) {
    const values = this.crate.utils.asArray(value);
    var newValues = []
    for (let val of values) {
      if (val["@id"]) {
        const target = this.crate.getItem(val["@id"]);
        if (target) { 
          if(target.name && !returnJson) {
            newValues.push(target.name);
          }
          else {
            newValues.push(JSON.stringify(target).replace(/"/, '\"'));
          }
        } 
      } 
      else {
        newValues.push(val)
      }
      return newValues; 
  }
}
}



module.exports = CatalogSolr;