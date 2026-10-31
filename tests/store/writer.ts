import '../../src/suppress-warnings.js';

const { openStore } = await import('../../src/store/store.js');

const dbPath = process.argv[2];
const count = Number(process.argv[3]);
if (dbPath === undefined || !Number.isInteger(count)) {
  throw new Error('writer arguments are required');
}

const store = openStore(dbPath);
try {
  for (let index = 0; index < count; index += 1) {
    store.insertChange({
      title: `writer change ${index}`,
      keyPoint: 'concurrency',
      whatHow: 'write one row',
      why: 'exercise locking',
      shouldKnow: [{ kind: 'concept', text: 'SQLite serializes writers' }],
      coreDiff: `+${index}`,
      hunks: [],
      supersedes: [],
      branch: null,
      baseHead: null,
      client: null,
      model: null,
    });
  }
} finally {
  store.close();
}
