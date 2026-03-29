import * as fs from 'fs';
import * as path from 'path';
import { Task } from '../types';

const STATUS_ICONS: Record<string, string> = {
  complete: '✓',
  'in-progress': '▶',
  pending: '○',
  blocked: '✗',
};

interface TasksFile {
  tasks: Task[];
}

export function runStatus(projectRoot: string, dataDir: string): void {
  const projectName = path.basename(projectRoot);

  console.log('');
  console.log(`Project: ${projectName}`);
  console.log(`Root:    ${projectRoot}`);
  console.log('');

  if (!fs.existsSync(dataDir)) {
    console.log("Not initialized. Run 'ralph init' first.");
    return;
  }

  // Previously completed tasks
  const completedFile = path.join(dataDir, 'tasks.completed.json');
  if (fs.existsSync(completedFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(completedFile, 'utf8')) as TasksFile;
      const tasks = data.tasks ?? [];
      if (tasks.length > 0) {
        console.log(`  Previously completed: ${tasks.length} task(s)`);
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Active tasks
  const tasksFile = path.join(dataDir, 'tasks.json');
  if (!fs.existsSync(tasksFile)) {
    console.log("  No tasks.json found. Run 'ralph plan' to create one.");
    console.log('');
    return;
  }

  const data = JSON.parse(fs.readFileSync(tasksFile, 'utf8')) as TasksFile;
  const tasks = data.tasks ?? [];

  if (tasks.length === 0) {
    console.log('  No pending tasks.');
    console.log('');
    return;
  }

  // Status counts
  const counts: Record<string, number> = {};
  for (const t of tasks) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }
  const parts = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${count} ${status}`);
  console.log(`  Status: ${parts.join(', ')} (${tasks.length} total)`);
  console.log('');

  for (const t of tasks) {
    const icon = STATUS_ICONS[t.status] ?? '?';
    const dirStr = t.directory ? ` [${t.directory}]` : '';
    const depStr =
      t.dependencies && t.dependencies.length > 0
        ? ` (depends on: ${t.dependencies.join(',')})`
        : '';
    console.log(`  ${icon} #${t.id} [P${t.priority}]${dirStr} ${t.title}${depStr}`);
  }

  console.log('');
}
