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

export function formatBanner(projectName: string): string {
  return `\n  Project: ${projectName}\n`;
}

export function formatPlanningNotesStatus(dataDir: string): string {
  const notesPath = path.join(dataDir, 'planning-notes.md');
  if (fs.existsSync(notesPath)) {
    return `  Planning notes: found (${notesPath})`;
  }
  return `  Planning notes: not found (${notesPath})`;
}

export function formatCompletedCount(dataDir: string): string | null {
  const completedFile = path.join(dataDir, 'tasks.completed.json');
  if (!fs.existsSync(completedFile)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(completedFile, 'utf8')) as TasksFile;
    const tasks = data.tasks ?? [];
    if (tasks.length === 0) return null;
    return `  Previously completed: ${tasks.length} task(s)`;
  } catch {
    return null;
  }
}

export function formatTasksSummary(tasks: Task[]): string {
  if (tasks.length === 0) return '  No pending tasks.';

  const counts: Record<string, number> = {};
  for (const t of tasks) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }
  const parts = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${count} ${status}`);

  const lines: string[] = [];
  lines.push(`  Status: ${parts.join(', ')} (${tasks.length} total)`);
  lines.push('');

  for (const t of tasks) {
    const icon = STATUS_ICONS[t.status] ?? '?';
    const dirStr = t.directory ? ` [${t.directory}]` : '';
    const depStr =
      t.dependencies && t.dependencies.length > 0
        ? ` (depends on: ${t.dependencies.join(',')})`
        : '';
    lines.push(`  ${icon} #${t.id} [P${t.priority}]${dirStr} ${t.title}${depStr}`);
  }

  return lines.join('\n');
}

export function displayPreflight(projectName: string, dataDir: string): void {
  console.log(formatBanner(projectName));

  const notesStatus = formatPlanningNotesStatus(dataDir);
  console.log(notesStatus);

  const completedLine = formatCompletedCount(dataDir);
  if (completedLine !== null) {
    console.log(completedLine);
  }

  const tasksFile = path.join(dataDir, 'tasks.json');
  if (!fs.existsSync(tasksFile)) {
    console.log('  No existing tasks.json — starting fresh.');
    console.log('');
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(tasksFile, 'utf8')) as TasksFile;
    const tasks = data.tasks ?? [];
    console.log('  Existing tasks.json:');
    console.log('');
    console.log(formatTasksSummary(tasks));
    console.log('');
  } catch {
    console.log('  Could not read tasks.json.');
    console.log('');
  }
}
