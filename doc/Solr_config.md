# Solr Config

The indexer config is a json file. This document describes the contents of the "fields"
block, which tells the indexer how to transform RO-Crate items into Solr index documents.

* RO-crate JSON-LD
  - item Dataset -> solr document for Dataset
  - item Person  -> solr document for Person


For the rest of the indexer config, see indexer_config.md in this folder.

Terminology for this document:

* graph - the JSON-LD graph in the RO-crate
* item - the graph is a list of items
* id - the id of an item in the graph
* field - keys of an item 
* value - values of an item
* facet - a solr document can have one or more facets, which group it in aggregated searches
* filter - criteria by which items are included in the solr document
* solr field - field in the resulting solr index


## Sample config

This is an example of the "fields" block from an indexer config file, which shows the usual top-level config, and a very basic mapping for Dataset items.

    "fields": {
        "main_search": [ "name", "description", "id" ],
        "map_all": {
            "@id": [ "id", "id_orig" ],
            "@type": [ "record_type_s", "type_label" ]
        },
    
        "licenses": {
            "__default__": "public"
        },
    
        "types": {
    
            "Dataset": {
                "@reverse": { "skip": true },
                "hasPart": { "skip": true },
                "hasFile": { "skip": true }    
            }
        }
    }


## Top-level config

### licenses

### main_search

Configures which fields will be searched by the main search on the front page of the portal. A list of fields which will be copied from every indexed item (of every type) into the main_search field in the solr documents.

    "main_search": [ "name", "description", "author", "id" ]

### map_all

Fields which are copied for all items being indexed: allows for a case when different fields in different items may need to be folded together in the index. Each key is a field in the item and each value is a list of fields in the solr document. The default values should be left as they are.

    "map_all": {
    	"@id": [ "id", "id_orig" ],
    	"@type": [ "record_type_s", "type_label" ]
    }

## Item config

Rules for indexing items by @type. Each @type is configured by an object whose keys are fields, ie:

    "types": {
        "Dataset": {
    	   "creator":   { ... config for field 'creator' ... },
    	   "publisher": { ... config for field 'publisher' ... },
    	   "hasPart":   { ... config for field 'hasPart' }
        },
        "Person": {
            ... fields for a Person ...
        }
    }

If a @type is included in the "types" block, then each item of that type will be examined by the indexer and possibly indexed. Here is how the decision whether to index is made:

* is there a config block for this field? - if N, copy the raw value
* is **skip** true? - if Y, then skip this field
* if there is a **filter**, do any of the filters fail? - if Y, skip this entire item
* is the config block an array? - if Y, and any of the **match** conditions match, use that config block for the remaining steps
* is there a **resolve** item? - if Y, try to resolve the value, log an error if it fails
* copy the value or resolved values to Solr

The following section describes all of the key values which a config block can have.

### facet

Create a facet in the Solr index based on the value or values in this field. Facets are presented in the search interface and can be used to narrow down a search or "drill down" by category.

Facets can have a single or multiple values for a given item. For example, a facet on "year of publication" would be single, whereas a facet on "authors" would need to be multiple. To facet on multiple values, the **multi** flag needs to be set.

The value or values used for a facet can be its raw value in the item, its resolved value (found by traversing the graph), a specified field from the item, or a tokenised value.

The value of **facet** can just be **true** (note that it's a logical **true**, not the string "true"). In this case, the field will be faceted singly on its raw value.

    "name": { "facet":  true }

If the value of **facet** is an object with a value for **tokenize**, the raw value will be split on a delimiter to make a multiple facet (if **multi** is set)

An example of facetting on multiple values:

    "keywords": {
        "multi": true,
        "facet": {
            "tokenize": { "delim": "," }
        }
    }

"delim" can be a regular expression.

if the value of **facet** is an object with a value for **field**, that field will be used as the facet. (FIXME: I'm not sure how this interacts with the new resolve stuff and it may be redundant.)

Note that the **facet** config is used both at initialisation, where it turns on facetting in the Solr schema, and when indexing.

### index_as

Changes the field name which this field's value is given in the Solr index. For example, 

    "author": {
        "index_as": "lead"
    }

will copy the value from the "author" field in the item to "lead" in the Solr document.

### multi

If this is set to **true**, the field will be treated as an array of values whereever this is relevant (in resolving ids and making facets).

    "authors": {
        "facet": true,
        "multi": true,
        "resolve": true
    }

### skip

If **skip** is present and true, this field will not be copied to the Solr document.

    "hasPart": { "skip": true }


### filter

Test values of this field with a filter, and exclude the entire item from the index if the filter fails. The value of filter can be a string, for exact matches, or a regular expression.

If a filter exists on multiple fields for an item, it has to pass them all to be indexed.

    "path": { "filter":  "./" }                     # only index if path is "./""
    
    "path": { "filter": { "re": "^\\./|data/$" } }  # only index if path is "./" or "data/"

### resolve

Resolve fields whose value is a list of ids in the graph by looking them up in the graph and serialising the JSON results. If the "multi" flag is set, the results of resolution will be serialised separately and stored and facetted as an array, otherwise the values are serialised together.

These serialised results will be used as the facet values, if faceting is defined and the facet config doesn't specify something else.

**resolve** can traverse more than one relation in the graph using the **via** option. For example, if a Dataset was associated with one or more Persons, each of which has a Location, we could use **via** to resolve the double link to the Location, which would allow us to facet on Datasets by Location:

    ""

FIXME more details


### match

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


