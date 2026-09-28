import { pipeline } from '@huggingface/transformers';

/**
 * Text to vectors, with a model that runs here.
 *
 * The model is downloaded once into the machine's own cache and reused by every project, so its cost is paid once
 * per machine rather than once per repository. It is created lazily and memoised, because the first load reads a
 * few hundred megabytes off disk and a caller that asks twice should not pay for it twice.
 *
 * A machine with no network on its first run has no cached model, and that is a fact about the machine rather than
 * an error in the caller: `embedAvailable` answers it, so the tool above can say "the index is unavailable" instead
 * of failing a call the agent did nothing wrong to make.
 */

export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIMENSIONS = 384;

/** Long texts are the tokenizer's problem, and a batch is split so one large repository does not arrive at once. */
const BATCH_SIZE = 32;

const pipelines = new Map();
const availability = new Map();

async function pipelineFor(model) {
  if (!pipelines.has(model)) {
    pipelines.set(
      model,
      pipeline('feature-extraction', model).catch((error) => {
        pipelines.delete(model);
        throw error;
      }),
    );
  }
  return pipelines.get(model);
}

/** Whether the model can be loaded at all, answered rather than thrown. Memoised per model id. */
export async function embedAvailable({ model = EMBEDDING_MODEL } = {}) {
  if (availability.has(model)) return availability.get(model);

  const answer = await pipelineFor(model).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, reason: error.message }),
  );
  availability.set(model, answer);
  return answer;
}

const isBlank = (text) => typeof text !== 'string' || text.trim().length === 0;

/** One vector per input, in the input's order, each `EMBEDDING_DIMENSIONS` long and normalised. */
export async function embed(texts, { model = EMBEDDING_MODEL } = {}) {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error('embed needs a non-empty array of strings');
  }

  const extract = await pipelineFor(model);
  const vectors = [];

  for (let index = 0; index < texts.length; index += BATCH_SIZE) {
    const batch = texts.slice(index, index + BATCH_SIZE);
    // A blank input is replaced so the batch keeps its length: the pipeline would otherwise be given an empty
    // string, and a row that vanishes would silently shift every later row onto the wrong file.
    const answer = await extract(
      batch.map((text) => (isBlank(text) ? ' ' : text)),
      { pooling: 'mean', normalize: true },
    );
    vectors.push(...answer.tolist());
  }

  return vectors.map((vector, index) =>
    isBlank(texts[index]) ? vector.map(() => 0) : vector,
  );
}
