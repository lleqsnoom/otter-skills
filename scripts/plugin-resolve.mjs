/**
 * A module resolve hook for the plugin's MCP server: a bare package name that does not resolve from the plugin's own
 * files is looked up again in the plugin data directory's stage folders, in order. Relative paths and `node:`
 * builtins are never redirected, and a package found nowhere fails with Node's own error.
 */

let parents = [];

export async function initialize(data) {
  parents = data?.parents ?? [];
}

const isBare = (specifier) => !/^(?:\.{1,2}\/|\/|[a-zA-Z][a-zA-Z0-9+.-]*:)/.test(specifier);

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !isBare(specifier)) throw error;
    for (const parentURL of parents) {
      try {
        return await nextResolve(specifier, { ...context, parentURL });
      } catch {
        // Not in this stage; try the next.
      }
    }
    throw error;
  }
}
