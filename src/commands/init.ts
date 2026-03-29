import * as fs from 'fs';
import * as path from 'path';

const GITIGNORE_CONTENT = `# Ralph temp files (tasks.json and planning-notes.md are tracked)
.ralph_complete
.ralph_iterations.log
.ralph_prev_notes
.ralph_task_meta
.ralph_completed_ids
instructions.md
`;

export function initCoreFiles(projectRoot: string, dataDir: string): void {
  // Create .ralph/ directory
  if (fs.existsSync(dataDir)) {
    console.log('  .ralph/ directory already exists.');
  } else {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('  Created: .ralph/');
  }

  // Create .ralph/.gitignore
  const gitignorePath = path.join(dataDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT);
    console.log('  Created: .ralph/.gitignore');
  }

  // Create .ralph/tasks.json
  const tasksPath = path.join(dataDir, 'tasks.json');
  if (fs.existsSync(tasksPath)) {
    console.log('  tasks.json already exists.');
  } else {
    const projectName = path.basename(projectRoot);
    fs.writeFileSync(tasksPath, JSON.stringify({ project: projectName, tasks: [] }, null, 2) + '\n');
    console.log('  Created: .ralph/tasks.json');
  }
}
