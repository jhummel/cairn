import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { BRAND } from '../brand';
import { findConfigFile } from '../config';

export function runEdit(target: string, projectRoot: string, dataDir: string): void {
  let filePath: string;

  switch (target) {
    case 'tasks':
      filePath = path.join(dataDir, 'tasks.json');
      break;
    case 'plan':
    case 'notes':
      filePath = path.join(dataDir, 'planning-notes.md');
      break;
    case 'config':
      // Resolve, never reconstruct: a project still on ralph.json must open
      // that file rather than a cairn.json that does not exist.
      filePath = findConfigFile(projectRoot);
      break;
    default:
      console.error(`Unknown target: ${target}`);
      console.error(`Usage: ${BRAND.name} edit [tasks|plan|config]`);
      process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const editor = process.env.EDITOR || 'vi';
  spawnSync(editor, [filePath], { stdio: 'inherit' });
}
