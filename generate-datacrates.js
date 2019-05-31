const yargs = require('yargs');
const randomize = require('datacrate/lib/randomize');
const assert = require('assert');
const fs = require('fs-extra');

const argv = yargs['argv'];

assert.notStrictEqual(argv.n, undefined, 'Please include --n as number of datacrates to generate');
const numberOfDatacrates = argv.n;

assert.notStrictEqual(argv.d, undefined, 'Please include --d as directory where datacrates are to be generated');
const datacrateDirPath = argv.d;

async function createDatacrates(dest, n) {
  const sourcedata = await randomize.loadsourcedata('./node_modules/datacrate/vocabularies');
  const datapubs = randomize.randdatapubs(n, sourcedata);
  datapubs.reduce((promise, p, index) => {
    return promise.then(async () => {
      const id = await randomize.makedir(dest);
      return randomize.makedatacrate(dest, p, id)
          .then(() => {
            if (index >= n) {
              console.log("Done");
            }
            return Promise.resolve();
          });
    });
  }, Promise.resolve());
}

try {
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
