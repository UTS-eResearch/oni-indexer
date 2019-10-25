const randomize = require('./lib/randomize');
const ArgumentParser = require('argparse').ArgumentParser;

const parser = new ArgumentParser({
  version: '1.0.0',
  addHelp: true,
  description: 'Generates a bunch of plausible randomize DataCrates'
});


parser.addArgument(
    ['-d', '--directory'],
    {
      help: "Directory in which to write DataCrates. Will be created if it doesn't exist",
      defaultValue: './output/'
    }
);

parser.addArgument(
    ['-n', '--number'],
    {
      help: 'Number of DataCrates to generate.',
      type: 'int',
      defaultValue: 10
    }
);

parser.addArgument(
  ['-s','--script'],
  {
    help: 'Path to RO-Crate rendering script',
    type: 'string',
    defaultValue: 'https://data.research.uts.edu.au/examples/ro-crate/examples/src/crate.js'
  }

);

const args = parser.parseArgs();

console.log(`Generating ${args['number']} randomize DataCrates in ${args['directory']}`);

const dest = args['directory'];
const n = args['number'];
const script = args['script'];
async function createDatacrates(dest, n) {
  const sourcedata = await randomize.loadsourcedata('./vocabularies');
  const datapubs = randomize.randdatapubs(n, sourcedata);

  datapubs.reduce((promise, p, index) => {
    return promise.then(async () => {
      const id = await randomize.makedir(dest);
      return randomize.makerocrate(dest, p, id, script)
          .then(() => {
            if (index >= n) {
              console.log("Done");
            }
            return Promise.resolve();
          });
    })
  }, Promise.resolve());
}

createDatacrates(dest, n);