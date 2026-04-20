import type { Task } from './types';

export interface TasksFile {
  project?: string;
  tasks: Task[];
}

export class TasksFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TasksFileError';
  }
}

export function readTasksFile(
  _path: string,
  _opts?: { dataDir?: string }
): { data: TasksFile; repaired: boolean; restored: boolean; error?: string } {
  throw new Error('Not implemented');
}

export function writeTasksFile(_path: string, _data: TasksFile): void {
  throw new Error('Not implemented');
}

export function snapshotTasksFile(_path: string, _dataDir: string): void {
  throw new Error('Not implemented');
}
