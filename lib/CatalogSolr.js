const _ = require('lodash');
const assert = require('assert');

class CatalogSolr {

  constructor(jsonld) {
    this.jsonld = jsonld;
  }

  setConfig(config) {
    this.config = config;
    return this.validateConfig();
  }

  validateConfig() {
    // Dont you hate not knowing what the configuration needs?
    _.each(this.config, function (config) {
      assert.strictEqual(_.isObject(config['facets']), true, 'missing facets in configuration');
      assert.strictEqual(_.isObject(config['flatten']), true, 'missing special in configuration');
      assert.strictEqual(_.isArray(config['rootNodeFieldValues']), true, 'missing links in configuration');
    });
    return true;
  }

  loadFields() {

  }

  getSimple() {

  }

  enforceSolrFieldNames(k) {
    const k1 = k.replace('https?://schema.org/', '');
    return k1.replace(/[^a-zA-Z\d_]/, '_');
  }

  getFacets() {
    _.each(this.config['facets'], function (facet) {
      console.log(facet);
    });
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

    if (facetInfo['field_suffix'] === '_Dataset_facetmulti') {
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

  getGraphElement(config, graph, graphEle) {
    const base = {};
    _.forOwn(graphEle, (gg, kk) => {
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
              base[facetObject['key']] = facetObject['value'];
            }
            if (kk === '@type') {
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
                base[kk] = this.getGraphElement(config, graph, found);
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
}

module.exports = CatalogSolr;