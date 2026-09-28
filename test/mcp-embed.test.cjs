'use strict';

/**
 * The embedding step is the only part of the index that reaches outside the machine on its first run, and the only
 * part a later tool can fail on. So two things are asserted that the callers depend on: the vectors are the shape
 * the index stores (384, unit length, one per input, in order), and asking whether the model is available answers
 * rather than throws — an agent told "the index is unavailable" is not the same as a broken tool call.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const embed = () => import(pathToFileURL(path.join(ROOT, 'src', 'server', 'embed.mjs')).href);

const magnitude = (vector) => Math.hypot(...vector);
const cosine = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);

test('a batch embeds to one unit vector per input, in order', async () => {
  const { embed: run, EMBEDDING_DIMENSIONS, embedAvailable } = await embed();
  const available = await embedAvailable();
  if (!available.ok) {
    test.skip(`the model is not available here: ${available.reason}`);
    return;
  }

  const vectors = await run(['the first document', 'the second document']);

  assert.equal(vectors.length, 2);
  assert.equal(vectors[0].length, EMBEDDING_DIMENSIONS);
  for (const vector of vectors) {
    assert.ok(vector.every((value) => Number.isFinite(value)), 'every component is a number');
    assert.ok(Math.abs(magnitude(vector) - 1) < 1e-3, `the vector is normalised; got ${magnitude(vector)}`);
  }
  assert.notDeepEqual(vectors[0], vectors[1], 'different texts are different vectors');
});

test('the same text embeds to the same vector twice', async () => {
  const { embed: run, embedAvailable } = await embed();
  const available = await embedAvailable();
  if (!available.ok) {
    test.skip(`the model is not available here: ${available.reason}`);
    return;
  }

  const [first] = await run(['a stable sentence']);
  const [second] = await run(['a stable sentence']);

  assert.deepEqual(first, second);
});

test('related texts land closer together than unrelated ones', async () => {
  const { embed: run, embedAvailable } = await embed();
  const available = await embedAvailable();
  if (!available.ok) {
    test.skip(`the model is not available here: ${available.reason}`);
    return;
  }

  const [aboutDogs, alsoAboutDogs, aboutTax] = await run([
    'the dog barked at the postman',
    'a puppy barks loudly in the garden',
    'quarterly tax filings are due in april',
  ]);

  assert.ok(
    cosine(aboutDogs, alsoAboutDogs) > cosine(aboutDogs, aboutTax),
    'the two sentences about dogs are nearer each other than the one about tax',
  );
});

test('a batch larger than one call still comes back whole and in order', async () => {
  const { embed: run, embedAvailable } = await embed();
  const available = await embedAvailable();
  if (!available.ok) {
    test.skip(`the model is not available here: ${available.reason}`);
    return;
  }

  const texts = Array.from({ length: 64 }, (_, index) => `document number ${index}`);
  const vectors = await run(texts);

  assert.equal(vectors.length, 64);
  assert.notDeepEqual(vectors[0], vectors[63]);
});

test('a blank string embeds as the zero vector, so rows stay aligned with their inputs', async () => {
  const { embed: run, embedAvailable } = await embed();
  const available = await embedAvailable();
  if (!available.ok) {
    test.skip(`the model is not available here: ${available.reason}`);
    return;
  }

  const [blank] = await run(['   ']);

  assert.ok(blank.every((value) => value === 0), 'a blank input is the zero vector');
});

test('an empty array is refused', async () => {
  const { embed: run } = await embed();

  await assert.rejects(() => run([]), /non-empty/);
});

test('availability answers instead of throwing when the model cannot be loaded', async () => {
  const { embedAvailable } = await embed();

  const available = await embedAvailable({ model: 'no-such-org/no-such-model' });

  assert.equal(available.ok, false);
  assert.equal(typeof available.reason, 'string');
  assert.ok(available.reason.length > 0, 'and it says why');
});
