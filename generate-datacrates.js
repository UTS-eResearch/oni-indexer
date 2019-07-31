const yargs = require('yargs');
const randomize = require('datacrate/lib/randomize');
const assert = require('assert');
const fs = require('fs-extra');
const ocfl = require('ocfl');

const argv = yargs['argv'];

assert.notStrictEqual(argv.n, undefined, 'Please include --n as number of datacrates to generate');
const numberOfDatacrates = argv.n;
assert.notStrictEqual(argv.d, undefined, 'Please include --d as directory where datacrates are to be generated');
const datacrateDirPath = argv.d;

const ocfl = argv.o;

const TEMPDIR = './tmp/';



// if putting them in an ocfl repository, write them to a temporary dest/ and then
// check them in (so I don't have to update the datacrate library too much


async function createDatacrates(dest, n) {
  const sourcedata = await randomize.loadsourcedata('./node_modules/datacrate/vocabularies');
  const datapubs = randomize.randdatapubs(n, sourcedata);
  datapubs.reduce((promise, p, index) => {
    return promise.then(async () => {
      return createDatacrate(dest, p).then(() => {
            if (index >= n) {
              console.log("Done");
            }
            return Promise.resolve();
          });
    });
  }, Promise.resolve());
}

async function createDatacrate(dest, pub, id) {
  if( ocfl ) {
    const id = await randomize.makedir(TMP);
    await randomize.makedatacrate(TMP, pub, id);
    
  } else {
      const id = await randomize.makedir(dest);
      return randomize.makedatacrate(dest, p, id)



try {
  if( ocfl ) {
    fs.ensureDirSync(TEMP);
  }
  fs.ensureDirSync(datacrateDirPath);
  createDatacrates(datacrateDirPath, numberOfDatacrates)
      .then(() => {
        console.log(numberOfDatacrates + ' datacrates generated in ' + datacrateDirPath);
      })
      .catch((err) => {
        throw new Error(err);
      })
} catch (e) {
  console.error(e.message);
}
