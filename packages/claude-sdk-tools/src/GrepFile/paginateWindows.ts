import type { Window } from './mergeWindows';

export function paginateWindows(windows: Window[], skip: number, limit: number): Window[] {
  return windows.slice(skip, skip + limit);
}
