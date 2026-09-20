import type { APIRoute } from 'astro';

import { getSnapshot } from '../../server/snapshot.mjs';

export const GET: APIRoute = ({ url }) => {
  const force = url.searchParams.get('force') === '1';
  const snapshot = getSnapshot({ force });
  return new Response(JSON.stringify(snapshot), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};