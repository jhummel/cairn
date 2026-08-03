import * as fs from 'fs';
import { findTempFilePath } from '../utils';

export function runLogs(dataDir: string): void {
  const logFile = findTempFilePath(dataDir, 'iterations.log');

  if (!fs.existsSync(logFile)) {
    console.log('No iteration log found.');
    return;
  }

  const contents = fs.readFileSync(logFile, 'utf-8');
  console.log(contents);
}
