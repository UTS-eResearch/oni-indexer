const _ = require('lodash');
const assert = require('assert');
const ROCrate = require('ro-crate').ROCrate;
const fs = require('fs-extra');
const Utils = require('ro-crate').Utils;
const path = require('path');

class CatalogSolr {

  constructor() {
  }

  setConfig(config) {
    this.config = config;
    this.typeFilters = {};
    this.root = undefined;
    this.errors = [];

    _.each(this.config['types'], ( typecf, type ) => {
      const typef = {};
      _.each(typecf, ( fieldcf, field ) => {
        if( 'filter' in fieldcf ) {
          typef[field] = fieldcf['filter'];
        }
        if( field === 'licence' ) {
          this.errors.push(type);
        }
      });
      this.typeFilters[type] = this.compileFilter(typef);
    });

    if( this.errors.length > 0 ) {
      console.log(`
For consistency with schema.org, this codebase uses the US spelling
of "license". Your fields config has at least one type which uses
the Commonwealth spelling "licence". Rather than silently not apply
a license, this indexer won't run until you change the spelling to.
"license".

Types with errors: ${this.errors.join(', ')}`);
      return false;
    }

    this.licenses = this.compileLicense();
    return true;
  }

  // build a filter function from the config for an item type

  compileFilter(cf) {
    const fs = [];
    if( typeof cf === 'string') {
      // if the cf is just a string
      fs.push(this.makeEq('', cf))
    } else {
      if( 're' in cf ) {
        // if the cf looks like a re, not a set of field matches
        fs.push(this.makeEq('', new RegExp(cf['re'])))
      } else {
        _.each(cf, ( condition, field ) => {
          if( typeof condition === 'object' ) {
            if( condition['re'] ) {
              fs.push(this.makeEq(field, new RegExp(condition['re'])));
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
            const f = this.makeEq(field, condition);
            fs.push(f);
          }
        });
      }
    }
    // match only if every predicate is true
    return (item) => _.every(fs, (f) => f(item));
  }

  // Builds a closure which matches against an item's value for field if
  // - the value is a string which matches
  // - the value is an array containing at least one string which matches
  // the target param can be a RegExp or a string

  makeEq(field, target) {
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
      if( typeof item === 'string') {
        return match(item);
      }
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



  // pathResolver is an async function which resolves a file path in the ro-crate
  // to a real filename - it handles ocfl resolution for the full-text search


  async createSolrDocument(jsonld, pathResolver) {
    this.crate = new ROCrate(jsonld);
    this.pathResolver = pathResolver;

    // Keep track of things that are resolved and have index config (ignoring filter)
    this.resolvedItemsToIndex = [];
    this.alreadyIndexed = {};

    this.crate.index();

    const cfBase = this.config['map_all'] || {};
    const cfTypes = this.config['types'];

    // do the root Dataset item first

    const datasetCf = cfTypes['Dataset'];

    if(! datasetCf) {
      throw Error("ro-crate to solr config must have a Dataset type");
    }

    this.root = this.crate.getRootDataset();
    if( !this.root ) {
      throw Error("Couldn't find ro-crate's root dataset");
    }
    // clone the item and rewrite its @id to a named identifier if
    // that's been configured
    const rootItem = _.clone(this.root);
    const rootOrigId = rootItem['@id']; // so we can skip it later

    if( datasetCf['@id'] ) {
      const namespace = datasetCf['@id']['name'];
      const identifier = this.crate.getNamedIdentifier(namespace);
      if( identifier ) {
        rootItem['@id'] = identifier;
      } else {
        throw Error("Couldn't find named identifier " + namespace)
      }
    }

    rootItem['licenseOriginal'] = rootItem['license'];
    rootItem['license'] = this.mapLicenses(rootItem['license']);
    const rootSolr = await this.mapItem(cfBase, datasetCf, 'Dataset', rootItem);
    const solrDocument = { 'Dataset': [ rootSolr ] };

    // First cut of inheritance for licenses: if an item doesn't have a field
    // X, and X has 'inherit' set to True, copy it from the rootItem's X, if
    // that exists. (NOTE: inheritance goes straight to the rootItem, not up
    // the tree of resolutions)

    this.rootItem = rootItem; // set this so that inheritance can access it



    // loop through each item in the JSON-LD @graph
    await this.indexItems(this.crate.json_ld["@graph"], rootOrigId, cfTypes, cfBase, solrDocument, false);
    var additionalItems = _.clone(this.resolvedItemsToIndex)
    this.resolvedItemsToIndex = []
    while (additionalItems.length > 0) {
      // Don't filter things that were resolved
      await this.indexItems(additionalItems, rootOrigId, cfTypes, cfBase, solrDocument, true);
      additionalItems = _.clone(this.resolvedItemsToIndex)
      this.resolvedItemsToIndex = []
    }
    return solrDocument;
  }


  async indexItems(items, rootOrigId, cfTypes, cfBase, solrDocument, auto) {
    for (const item of items) {
      if (item['@id'] !== rootOrigId) {
        var types = this.crate.utils.asArray(item['@type']);
        // Look through types in order 
        for (let type of Object.keys(cfTypes)) {
          if (types.includes(type)) {
            
            // get config for this type of item
            const cf = cfTypes[type];
            // If auto flag set always index regardless of filter
            if (auto || this.typeFilters[type](item)) {
              // Only do ONCE per type    
              types = [type];
              item["@type"] = types;
              const solr = await this.mapItem(cfBase, cf, type, item);
              if (!(solrDocument[type])) {
                solrDocument[type] = [];
              }
              
              solrDocument[type].push(solr);
            }
          }
        }
      }
    }
  }

  // map the fields in an an ro-crate item to a solr document
  // this.solr gets inited by this method so that mapValue can
  // add things to it

  async mapItem(cfBase, cf, type, item) {
    this.solr = this.baseSolr(cfBase, item);
    for( let field in item ) {
      const value = item[field];
      const indexValues = this.getIndexCf(type, cf, field, value);
      for( let i of indexValues ) {
        if( !(i['field'] in cfBase) ) {
          await this.mapValue(type, i['field'], i['cf'], i['value'])
        }
      }
    }
    // look for fields with 'inherit' which didn't have a value
    _.each( cf, ( fieldcf, field ) => {
      if( fieldcf['inherit'] ) {
        if( ! this.solr[field] ) {
          console.log(`Inheriting ${field} from root`)
          this.solr[field] = this.rootItem[field];
          if( ! this.rootItem[field] ) {
            console.log(`WARNING: no ${field} on root item`);
            console.log(`Root item: ${JSON.stringify(this.rootItem)}`);
          }
        }
      }
    });
    return this.solr;
  }

  // mapValue(type, field, fieldcf, value)
  //
  // make the solr index (and facets where configured) for a single
  // type, field, cf and value
  //
  // NOTE: this writes the results into the current this.solr, which
  // I don't like much, but I like it better than passing a solr object
  // into the method, or passing out all the values and updating them

  async mapValue(type, field, fieldcf, value) {
    if( ! fieldcf ) {
      // no config for this field so copy
      this.solr[field] = this.unwrap(value);
    } else {
      if( ! fieldcf['skip'] ) {
        // load files
        if( fieldcf['load_file'] ) {
          this.solr[field] = await this.loadFile(value);
        } else {
          // resolve lookups
          if( fieldcf['resolve'] ) {
            this.solr[field] = this.resolveValues(fieldcf['resolve'], value);
            const vals = this.crate.utils.asArray(this.solr[field]);
            this.solr[`${field}_id`] =  [];
            for (let val of vals) {
              try {
                const value = JSON.parse(val);
                this.solr[`${field}_id`].push(value["@id"]);
              } catch (e) {
                console.log("Resolution error: ", e.message, val)
              }
            }
          } else {
            this.solr[field] = this.unwrap(value, fieldcf.escapedJSON);
          }
          if( fieldcf['validate'] ) {
            this.solr[field] = this.validate(fieldcf['validate'], this.solr[field]);
            // TODO add year
          }
        }
        // make facets - these can be based on raw or resolved values depending
        // on the faceting rule, so pass both in
        if( fieldcf['facet'] ) {
          const facet = this.makeFacet(fieldcf['facet'], value, this.solr[field]);
          const facetField = [ type, field, Array.isArray(facet) ? 'facetmulti' : 'facet'].join('_');
          this.solr[facetField] = facet;
        }
      }
    }
  }

  // 

  getIndexCf(type, cf, field, value) {
    if( !Array.isArray(cf[field]) ) {
      // if there's only one config, don't split the values
      return [ { field: field, cf: cf[field], value: value } ];
    } else {
      const indexable = [];
      const values = Array.isArray(value) ? value : [ value ];
      _.each(cf[field], (indexCf) => {
        const matcher = this.compileFilter(indexCf['match']);
        const ivalues = values.filter((v) => typeof(v) === 'object' && matcher(v));
        if( ivalues.length > 0 ) {
          indexable.push({
            field: indexCf['index_as'],
            cf: indexCf,
            value: ivalues
          });
        }
      });
      return indexable;
    } 
  }



  resolveValues(cf, value) {
    if( typeof value !== 'object' ) {
      return value;
      const error = this.convertError(`Can't resolve '${value}'`);
      return ( cf === 'multi' ) ? [ error ] : error;
    }
    if( cf === 'multi' ) {
      if( Array.isArray(value) ) {
        return value.map((v) => this.resolveAndFlatten(v));
      } else {
        return [ this.resolveAndFlatten(value) ];
      }
    } else {
      if( Array.isArray(value) ) { 
        return this.resolveAndFlatten(value[0]);
      } else {
        return this.resolveAndFlatten(value);
      }
    }
  }


  resolveAndFlatten(value, solr) {
    if( !('@id' in value ) ) {
      return value;
      return this.convertError(`no @id found in value ${JSON.stringify(value)}`);
    }
    const resolved = this.crate.getItem(value['@id']);
    if( !resolved ) {
      return this.convertError(`@id ${value['@id']} not found`);
    }
    
    const resolvedTypes = this.crate.utils.asArray(resolved["@type"]);
    for (let type of Object.keys(this.config['types'])) {
      const cf = this.config['type'];
      if (resolvedTypes.includes(type) && !this.alreadyIndexed[resolved["@id"]]) {
        this.alreadyIndexed[resolved["@id"]] = true;
        this.resolvedItemsToIndex.push(resolved);
      }
    }

    return JSON.stringify(resolved).replace(/"/g, '\"');    
  }

  // returns

  makeFacet(cf, raw, resolved) {

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
          const lookup = this.crate.getItem(v['@id']);
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
        const m = value.match(/(\d\d\d\d-\d\d-\d\d)/);
        if( m ) {
          return m[1];          
        } 
        this.convertError(`Invalid ${type}: ${value}`);
        return '';
      }
      this.convertError(`Unknown validation type ${type}`);
    }
  }


  async loadFile(value) {
    const file = value[0];
    if( !file['@id'] ) {
      console.log("Can't find id on file");
      return '';
    }
    const filename = await this.pathResolver(file['@id']);

    try {
      const content = await fs.readFile(filename, 'utf8');
      return content;
    } catch(e) {
      console.log(`Error loading file ${file['@id']}: ${e}`);
      return '';
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