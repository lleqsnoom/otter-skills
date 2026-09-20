import type { APIRoute } from 'astro';

import { listDirectories } from '../../server/roots.mjs';

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: HEADERS });

/**
 * The folders a picker may show, one level at a time.
 *
 * It lists directories and returns their names — never a file, and never a file's contents — because choosing a root
 * is choosing a folder. With no `path` it answers from the home directory, so a picker has somewhere to start, and
 * every answer carries its own `parent`, so walking up needs no path arithmetic in the browser.
 */
export const GET: APIRoute = ({ url }) => {
  const answer = listDirectories(url.searchParams.get('path'));
  if (answer.status !== 200) return json(answer, answer.status);
  return json(answer.body);
};
