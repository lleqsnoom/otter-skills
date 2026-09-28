import type { APIRoute } from 'astro';

import { readAsset } from '../../server/snapshot.mjs';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

/**
 * An image a project carries — the icon it was given — as bytes.
 *
 * Its own route because `/api/file` answers JSON: a document's text is what that route is for, and a browser cannot
 * put JSON in an `<img>`. `nosniff` keeps a stored file from being treated as anything but the type it was read as.
 */
export const GET: APIRoute = ({ url }) => {
  const answer = readAsset(url.searchParams.get('project') || '', url.searchParams.get('path') || '');
  if (answer.status !== 200 || !answer.body) {
    return new Response(JSON.stringify(answer), { status: answer.status, headers: JSON_HEADERS });
  }

  // A copy rather than the Buffer itself: Node types it over an `ArrayBufferLike`, which the DOM's `BodyInit` refuses,
  // and a fresh `Uint8Array` is over the plain `ArrayBuffer` it asks for. The reader caps an asset at 4 MB, so this is
  // one bounded copy of an icon and not a reason to reach for a cast.
  const bytes = new Uint8Array(answer.body);
  return new Response(bytes, {
    headers: {
      'content-type': answer.contentType,
      'content-length': String(bytes.byteLength),
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  });
};
