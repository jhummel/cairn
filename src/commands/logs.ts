import * as fs from 'fs';
import * as path from 'path';

export function runLogs(dataDir: string): void {
  const logFile = path.join(dataDir, '.ralph_iterations.log');

  if (!fs.existsSync(logFile)) {
    console.log('No iteration log found.');
    return;
  }

  const contents = fs.readFileSync(logFile, 'utf-8');
  console.log(contents);
}
