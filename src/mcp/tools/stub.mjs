/**
 * A tool that answers before its reader exists, so the protocol surface is fixed and testable from the first layer
 * while the readers behind it land one at a time. A stub echoes the call it received.
 */
export function stub(name) {
  return async (args) => ({ text: `${name} called with ${JSON.stringify(args ?? {})}` });
}
