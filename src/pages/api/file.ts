import type { APIRoute } from 'astro';

import { readFileContent, writeFileContent } from '../../server/snapshot.mjs';

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function answer(result: { status: number; body?: unknown; error?: string }) {
  return new Response(JSON.stringify(result.status === 200 ? result.body : result), {
    status: result.status,
    headers: HEADERS,
  });
}

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), { status, headers: HEADERS });
}

/** One artifact, in full: markdown rendered, code coloured, and the raw text beside both so it can be edited. */
export const GET: APIRoute = ({ url }) =>
  answer(readFileContent(url.searchParams.get('project') || '', url.searchParams.get('path') || ''));

/**
 * The same artifact, written back. The answer is the file as it now reads — re-rendered, with its new size and
 * `mtime` — so the screen has nothing to guess about what a save did. A refusal carries the reason and the status
 * it belongs to: 415 for a file that is not a text artifact, 413 for one larger than a page will hold.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: { project?: string; path?: string; content?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'expected a JSON body' }, 400);
  }

  const project = typeof body.project === 'string' ? body.project : '';
  const path = typeof body.path === 'string' ? body.path : '';
  if (!project || !path) return json({ error: 'project and path are required' }, 400);

  return answer(writeFileContent(project, path, body.content));
};
