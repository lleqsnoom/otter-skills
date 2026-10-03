/**
 * The semantic index's packages — LanceDB and transformers.js — load on first use rather than at import. A plugin
 * install starts this server before those packages have finished installing in the background, and the exact tools
 * (find_symbols, search_code, read_code) must work in the meantime.
 */

export class MissingDependency extends Error {}

/** Import `name`, or throw a MissingDependency an agent can act on instead of Node's resolution error. */
export async function importOptional(name) {
  try {
    return await import(name);
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    throw new MissingDependency(
      `${name} is not installed yet, so the semantic index is unavailable. A plugin install adds it in the background ` +
        'after the server first starts; until then the exact tools (find_symbols, search_code, read_code) work.',
    );
  }
}
