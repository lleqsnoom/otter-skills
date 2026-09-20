import { createContext, useContext, type JSX } from 'solid-js';

import type { BoardDeletions } from './types';

/**
 * What a page needs in order to archive an artifact: the decisions made so far, and the one write that makes
 * another. It travels as a context because the page that reads an artifact is not always the page that knows which
 * repository it is in — a file's own address names the file, and the route is what knows the project.
 */
export interface BoardAccess {
  deletions: () => BoardDeletions;
  onDelete: (relPath: string, deleted: boolean) => void;
}

const BoardContext = createContext<BoardAccess>({ deletions: () => ({}), onDelete: () => {} });

export function BoardProvider(props: BoardAccess & { children: JSX.Element }) {
  return <BoardContext.Provider value={props}>{props.children}</BoardContext.Provider>;
}

export function useBoard(): BoardAccess {
  return useContext(BoardContext);
}
