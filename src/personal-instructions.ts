import * as fs from 'fs';
import * as path from 'path';

export function loadPersonalInstructions(dataDir: string): string {
  const instructionsFile = path.join(dataDir, 'instructions.md');
  if (fs.existsSync(instructionsFile)) {
    const content = fs.readFileSync(instructionsFile, 'utf-8');
    if (content.trim()) {
      return `\nPERSONAL INSTRUCTIONS:\n${content}\n`;
    }
  }
  return '';
}
