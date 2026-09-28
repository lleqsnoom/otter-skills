import { epicIndex, epicOfSelf, epicOfTasks } from '../lib/epics.mjs';

/**
 * The task artifacts a scanned project holds, each with the plan it belongs to.
 *
 * The board's scanner files tasks two ways — loose in `tasks/`, or in a folder of their own — and a caller that
 * only looked at one of them would read half a project. The epic a task belongs to comes from `src/lib/epics.mjs`,
 * the same rules the board uses, so an agent's answer and the screen's answer cannot disagree about which plan a
 * task was cut from.
 */
export function tasksOf(project) {
  const category = project.categories.find((candidate) => candidate.work === 'task');
  if (!category) return [];

  const index = epicIndex(project.categories);
  const tasks = [];

  for (const group of category.groups ?? []) {
    const epic = epicOfTasks(index, group);
    for (const item of group.items ?? []) tasks.push({ item, epic, container: group.relPath });
  }
  for (const item of category.items ?? []) {
    tasks.push({ item, epic: epicOfSelf(index, item), container: null });
  }

  return tasks;
}

/** The plans a project holds, as the epic index reads them. */
export function epicsOf(project) {
  if (!project.categories.some((category) => category.work === 'epic')) return [];
  return [...epicIndex(project.categories).values()];
}
