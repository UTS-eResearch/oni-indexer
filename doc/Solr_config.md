# Solr Config

Config is a json file which defines a mapping from items in an RO-crate's JSON-LD graph to Solr documents:


* RO-crate JSON-LD
  - item Dataset -> solr document for Dataset
  - item Person  -> solr document for Person


Terminology for this document:

* graph - the JSON-LD graph in the RO-crate
* item - the graph is a list of items
* id - the id of an item in the graph
* path - the path of an item
* field - keys of an item 
* value - values of an item
* facet - a solr document can have one or more facets, which group it in aggregated searches
* filter - criteria by which items are included in the solr document
* solr field - field in the resulting solr index


## map_all

Fields which are copied for all items being indexed. Each key is a field in the item, each value is a list of solr fields

    "map_all": {
    	"@id": [ "id", "id_orig" ],
    	"@type": [ "record_type_s", "type_label" ]
    }

## types

Rules for indexing graph objects by @type. Each @type is configured by an object whose keys are fields, ie:

    "Dataset": {
    	"creator": { ... creator config ... },
    	"publisher": { ... },
    	"hasPart": { "skip": true }
    }

If a field has the value "skip", it won't be indexed. If it has a config object, that will be used to control how it's indexed. If it isn't skipped and doesn't have an object, it is copied directly into the Solr document.

## Field config

### skip

If "skip" is present and true, don't copy it to the solr index.

### filter

A filter to be applied to the values of this field. The value of filter can be a string, for exact matches, or a regular expression:

    "path": { "filter":  "./" }
    
    "path": { "filter": { "re": "^\\./|data/$" } }

If a filter exists on multiple fields for an item, it has to pass them all to be indexed

### resolve

Resolve fields whose value is a list of ids in the graph by looking them up in the graph and serialising the JSON results. If the value is "multi", the ids are serialised separately, otherwise the values are serialised together.

These serialised results will be used as the facet values, if faceting is defined and the facet config doesn't specify something else.

### facets

Facet can just be 'true', in which case a default facet(s) will be created.

Multiple facets are created if resolve is set to "multi" or if "tokenise" is set - see below.

The facet fieldname is set automatically to one of

    ${Type}_${field}_facet
    ${Type}_${field}_facetmulti

(The facet fieldnames used to be configured but this was redundant)


#### tokenize

A delimiter to be used to tokenise the value, ie ',' to split a list of keywords into an array. If this is present, the facet will be multi

#### field

A field to extract from the resolved facet values: this overrides whatever "resolve" returns

## Field matching

For situations where we need to map values from one type/field combination in an ro-crate to multiple fields in the Solr index. For example, FOR and SEO codes are both captured in the 'about' field of a Dataset:

    "about": [
        {
            "@id": "http://purl.org/au-research/vocabulary/anzsrc-for/2008/080503"
        },
        {
            "@id": "http://purl.org/au-research/vocabulary/anzsrc-for/2008/080302"
        },
        {
            "@id": "http://purl.org/au-research/vocabulary/anzsrc-for/2008/090609"
        },
        {
            "@id": "http://purl.org/au-research/vocabulary/anzsrc-seo/2008/890102"
        },
        {
            "@id": "http://purl.org/au-research/vocabulary/anzsrc-seo/2008/890202"
        }
    ],

but we may want to only index FOR codes, or index SEO and FOR codes into two different destination fields.

In this situation, we can configure multiple config items against a single type/field, and give each config item a 'match' value which is tested against the item, for example:

    "about": [
        {
            "match": { "@id": { "re": "anzsrc-for" } },
            "index_as": "FOR",
            "multi": true,
            "resolve": "multi",
            "facet": true
        },
        {
            "match": { "@id": { "re": "anzsrc-seo" } },
            "index_as": "FOR",
            "multi": true,
            "resolve": "multi",
            "facet": true
        },
     ],

The 'match' field uses the same filter spec as type filtering: in the above example, each 'about' value's '@id' field is matched against the regexp `/anzsrc-for/` for FOR codes and `/anzsrc-seo/` for SEO codes.

If a value matches more than one clause in this type of configuration, it will be indexed into Solr for every clause that it matches.

A match field can also match against plaintext values:

      "about": [
        {
            "match": { "@id": { "re": "anzsrc-for" } },
            "index_as": "FOR",
            "multi": true,
            "resolve": "multi",
            "facet": true
        },
        {
            "match": { "re": ".*" },
            "index_as": "Affiliation",
            "facet": true
        }
      ],

In the example, every 'about' item which is just a string (rather than an object) will be compared against the regexp `/.*/` - in other words, every string will be indexed as "Affiliation".

Note that at present, there would be an issue if you wanted to match against an item field called "re", as the config parser will treat "re" as a regular expression.


## Omitted for now

"type" faceting - I want to handle this separately as I think it needs to be applied to everything. So it should be in a global config section, not done on each item.


