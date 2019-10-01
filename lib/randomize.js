// Module to generate a bunch of CATALOG.json files which 
// have arbitrary but realistic data
//
// TODO: generate some random text files and add them 
// as well

const ORGANISATION = {
  'id': 'https://examples.edu',
  'name': 'Examples University'
};

const EMAIL_DOMAIN = 'examples.edu';

const NAME_MIN = 3;
const NAME_MAX = 10;
const KEYWORD_MIN = 3;
const KEYWORD_MAX = 12;
const WORD_MIN = 2;
const WORD_MAX = 14;
const SENTENCE_MIN = 3;
const SENTENCE_MAX = 30;
const PARA_MIN = 1;
const PARA_MAX = 10;

const N_KEYWORD_MIN = 2;
const N_KEYWORD_MAX = 10;

const N_PEOPLE_MIN = 1;
const N_PEOPLE_MAX = 5;

const HONORIFICS = ['Dr', 'A/Prof', 'Prof', 'Dr', 'Dr', 'Dr', 'Mr', 'Ms'];

const ROCrate = require('ro-crate').ROCrate;
const Preview = require('ro-crate').Preview;

const jsonld = require('jsonld');
const _ = require('lodash');
const fs = require('fs-extra');
const randdict = require('random-word');
const path = require('path');
const uuidv4 = require('uuid/v4');
const ArgumentParser = require('argparse').ArgumentParser;
const DateGenerator = require('random-date-generator');
const startDate = new Date(2010, 6, 1);
const endDate = new Date(2019, 6, 1);

const VOCABULARIES = './vocabularies';

function randrange(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

function randoms(n, fn) {
  return Array(n).fill(0).map(fn);
}


async function loadsource(file) {
  const text = await fs.readFile(file);
  return text.toString().split("\n");
}


function randperson(sourcedata) {
  const honorific = _.sample(HONORIFICS);
  const surname = _.sample(sourcedata['surnames']);
  const givenname = _.sample(sourcedata['givennames']);
  const name = givenname + ' ' + surname;
  const email = givenname + '.' + surname + '@' + EMAIL_DOMAIN;
  const id = `https://orcid.org/${uuidv4()}`;
  return {
    '@id': id,
    '@type': 'Person',
    'name': `${honorific} ${name}`,
    'givenName': givenname,
    'familyName': surname,
    'email': email
  }
}

function randkeyword() {
  return randdict();
}

function randsentence() {
  const nwords = randrange(SENTENCE_MIN, SENTENCE_MAX);
  const s = randoms(nwords, randdict).join(' ') + '.';
  return _.upperFirst(s);
}

function randtext() {
  const nsentences = randrange(PARA_MIN, PARA_MAX);
  return randoms(nsentences, randsentence).join(' ') + '\n';
}

function randdatapub(keywords, people) {
  const k = _.sampleSize(keywords, randrange(N_KEYWORD_MIN, N_KEYWORD_MAX));
  const title = _.startCase(_.camelCase(randsentence()));
  const desc = randtext();
  const creators = _.clone(_.sampleSize(people, randrange(N_PEOPLE_MIN, N_PEOPLE_MAX)));

  //TODO - add radnomised licenses for access control testing
  return {
    keyords: k,
    author: creators,
    name: title,
    description: desc,
    datePublished: DateGenerator.getRandomDateInRange(startDate, endDate).toISOString().slice(0,10),
    contactPoint:  {
      "@id": "contact@examples.edu",
      "@type": "ContactPoint",
      "contactType": "customer service",
      "email": "contact@examples.edu",
      "identifier": "peter.sefton@uts.edu.au",
      "name": "Contact our data manager"
    },
    license: {
      "@id": "https://creativecommons.org/licenses/by-nc-sa/3.0/au/",
      "@type": "CreativeWork",
      "description": "This work is licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Australia License. To view a copy of this license, visit http://creativecommons.org/licenses/by-nc-sa/3.0/au/ or send a letter to Creative Commons, PO Box 1866, Mountain View, CA 94042, USA.",
      "identifier": "https://creativecommons.org/licenses/by-nc-sa/3.0/au/",
      "name": "Attribution-NonCommercial-ShareAlike 3.0 Australia (CC BY-NC-SA 3.0 AU)"
    }
  }
}


module.exports = {
  loadsourcedata: async function (dir) {
    const sourcedata = {};
    sourcedata['surnames'] = await loadsource(path.join(dir, 'surname.txt'));
    sourcedata['givennames'] = await loadsource(path.join(dir, 'givenname.txt'));
    return sourcedata;
  },
  randdatapubs: function (n, sourcedata) {
    const keywords = randoms(Math.floor(n / 2), randkeyword);
    const people = randoms(n * 2, () => {
      return randperson(sourcedata)
    });
    return randoms(n, () => randdatapub(keywords, people))
  },
  makedir: async function (dest) {
    const id = uuidv4();
    const createDir = await fs.ensureDir(path.join(dest, id));
    return id;
  },
  makerocrate: async function (dest, datapub, id, script) {
    const crate = new ROCrate();
    crate.index();
    var root = crate.getRootDataset();
    root.id = id;
    for (prop of Object.keys(datapub)){
      root[prop] = datapub[prop];
    }

    

    const catfile = path.join(dest, id, 'ro-crate-metadata.jsonld');
    const htmlFile = path.join(dest, id, 'ro-crate-preview.html');

    const context = {"@context": crate.defaults.context}

    
    // TODO - Add this to Datacrate
    crate.json_ld =  await jsonld.flatten(crate.json_ld, context);
    console.log("Writing", catfile, htmlFile, script)
    const preview = new Preview(crate);
    await fs.writeFile(htmlFile, await preview.render(null, script));
    await fs.writeFile(catfile, JSON.stringify(crate.json_ld, null, 2));

  }
};