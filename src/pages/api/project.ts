import type { APIRoute } from 'astro';

import { createProject, projectDefaults } from '../../server/create.mjs';
import { clearParseCache } from '../../server/scan.mjs';
import { invalidateSnapshot } from '../../server/snapshot.mjs';

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: HEADERS });
}

/**
 * What a new project defaults to — the account, the directory its folder would go in, and the licenses GitHub
 * publishes — so the form can show a path and a list before anything is typed.
 */
export const GET: APIRoute = () => json(projectDefaults());

/**
 * A project, made: the one route that creates a repository rather than editing one, so it writes nothing itself —
 * `create.mjs` owns the tree, the commit and the GitHub push, and answers with the status a refusal belongs to.
 * Both caches are dropped on success for the same reason `/api/refresh` drops them: the new project has to be in
 * the answer the next screen reads.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: { name?: string; about?: string; baseDir?: string; icon?: unknown; visibility?: string; license?: string | null };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'expected a JSON body' }, 400);
  }

  const answer = createProject(body);
  if (!answer.ok) return json(answer, answer.status);

  invalidateSnapshot();
  clearParseCache();
  return json(answer);
};