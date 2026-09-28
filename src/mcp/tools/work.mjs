import * as z from 'zod';

import { listDocuments, readDocument } from '../../server/docs.mjs';
import { boardForProject } from '../../server/board.mjs';
import { driftFor } from '../../server/drift.mjs';
import { writeDrift } from '../../server/index.mjs';
import { epicsOf, tasksOf } from '../../server/work.mjs';
import { asText, projectOrThrow, resolveProjects } from '../context.mjs';

/**
 * The work tree and its documents: the tasks a project holds, the plans they belong to, and the README and
 * documents beside them.
 *
 * A lane and an archived flag are the *reader's* decisions, kept in the project's own `board.json`, so they are
 * reported as such and never as the file's own content — the file says what the work is, the board says where
 * somebody put it.
 *
 * Every path these tools answer with is relative to the repository, `.x-skills/` included, so one rule covers
 * tasks, documents and source: the path an agent was given is the path it may pass back.
 */

const COLUMN_OF_STATUS = { done: 'done', active: 'active', todo: 'todo' };

const SKILLS = '.x-skills';

const skillsPath = (relPath) => `${SKILLS}/${relPath}`;

function present(task, projectId, board) {
  const key = `${projectId}:${task.item.relPath}`;
  const lane = board.moves[key]?.column ?? COLUMN_OF_STATUS[task.item.status] ?? 'unknown';

  return {
    path: skillsPath(task.item.relPath),
    title: task.item.title,
    status: task.item.status,
    progress: task.item.progress,
    lane,
    archived: board.deleted[key] !== undefined,
    epic: task.epic ? { title: task.epic.title, path: skillsPath(task.epic.relPath) } : null,
    container: task.container ? skillsPath(task.container) : null,
    excerpt: task.item.excerpt,
  };
}

export const WORK_TOOLS = [
  {
    name: 'list_epics',
    description: "List a project's plans and epics with the tasks under each",
    inputSchema: { project: z.string().optional().describe('the project id') },
    handler: async ({ project }) => {
      const context = resolveProjects();
      const found = projectOrThrow(context, project);
      const board = boardForProject({ root: found.root, projectId: found.id });
      const tasks = tasksOf(found).map((task) => present(task, found.id, board));

      const epics = epicsOf(found).map((epic) => ({
        path: skillsPath(epic.relPath),
        title: epic.title,
        step: epic.step,
        runPath: epic.runPath ? skillsPath(epic.runPath) : null,
        tasks: tasks.filter((task) => task.epic?.title === epic.title),
      }));

      return { text: asText({ project: found.id, epics }) };
    },
  },
  {
    name: 'list_tasks',
    description: "List a project's tasks with their state, epic, lane and archived flag",
    inputSchema: {
      project: z.string().optional().describe('the project id'),
      state: z.enum(['todo', 'active', 'done']).optional().describe('keep only tasks in this state'),
      epic: z.string().optional().describe('keep only tasks belonging to this epic'),
    },
    handler: async ({ project, state, epic }) => {
      const context = resolveProjects();
      const found = projectOrThrow(context, project);
      const board = boardForProject({ root: found.root, projectId: found.id });

      let tasks = tasksOf(found).map((task) => present(task, found.id, board));
      if (state) tasks = tasks.filter((task) => task.status === state);
      if (epic) tasks = tasks.filter((task) => task.epic && task.epic.title.includes(epic));

      return { text: asText({ project: found.id, count: tasks.length, tasks }) };
    },
  },
  {
    name: 'get_task',
    description: 'Read one task in full, with its parsed fields, lane and archived flag',
    inputSchema: {
      project: z.string().optional().describe('the project id'),
      path: z.string().describe('the task path, relative to the repository'),
    },
    handler: async ({ project, path: asked }) => {
      const context = resolveProjects();
      const found = projectOrThrow(context, project);
      const rootRelative = asked.startsWith(`${SKILLS}/`) ? asked.slice(SKILLS.length + 1) : asked;

      const task = tasksOf(found).find((candidate) => candidate.item.relPath === rootRelative);
      if (!task) throw new Error(`no such task: ${asked}`);

      const board = boardForProject({ root: found.root, projectId: found.id });
      const read = readDocument({ repoPath: found.repoPath, relPath: asked });
      if (read.status !== 200) throw new Error(read.error);

      return { text: asText({ ...present(task, found.id, board), fields: task.item.fields, text: read.text }) };
    },
  },
  {
    name: 'list_docs',
    description: "List a project's README and its other documents",
    inputSchema: { project: z.string().optional().describe('the project id') },
    handler: async ({ project }) => {
      const context = resolveProjects();
      const found = projectOrThrow(context, project);

      const skillsDocuments = (found.categories.find((category) => category.id === 'docs')?.items ?? []).map(
        (item) => item.relPath,
      );
      const listed = listDocuments({ repoPath: found.repoPath, skillsDocuments });

      return {
        text: asText({
          project: found.id,
          mode: listed.mode,
          count: listed.documents.length,
          documents: listed.documents,
        }),
      };
    },
  },
  {
    name: 'read_doc',
    description: 'Read one document, always with its drift report against the code',
    inputSchema: {
      project: z.string().optional().describe('the project id'),
      path: z.string().describe('the document path, relative to the repository'),
    },
    handler: async ({ project, path: asked }) => {
      const context = resolveProjects();
      const found = projectOrThrow(context, project);

      const read = readDocument({ repoPath: found.repoPath, relPath: asked });
      if (read.status !== 200) throw new Error(read.error);

      // The report is computed from the file that was just read, so it describes the same bytes the caller gets.
      const report = driftFor({ docPath: read.relPath, markdown: read.text, repoPath: found.repoPath });
      const persisted = await writeDrift({ project: found, docPath: read.relPath, report });

      return {
        text: asText({
          project: found.id,
          path: read.relPath,
          title: read.title,
          size: read.size,
          mtime: read.mtime,
          truncated: read.truncated,
          text: read.text,
          drift: {
            checked: report.checked,
            capped: report.capped,
            persisted: persisted.ok,
            persistedReason: persisted.ok ? undefined : persisted.reason,
            claims: report.claims,
          },
        }),
      };
    },
  },
];
