import type { APIRoute } from 'astro';

import { clearParseCache } from '../../server/scan.mjs';
import { getSnapshot, invalidateSnapshot } from '../../server/snapshot.mjs';

/** Re-read every root from disk: the one write path, and it writes nothing but the cache. */
export const POST: APIRoute = () => {
  invalidateSnapshot();
  clearParseCache();
  const snapshot = getSnapshot({ force: true });
  return new Response(JSON.stringify(snapshot), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};