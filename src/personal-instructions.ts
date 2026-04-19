import * as fs from 'fs';
import * as path from 'path';

export function loadPersonalInstructions(dataDir: string): string {
  const filePath = path.join(dataDir, 'instructions.md');
  if (!fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf-8');
  if (content.trim() === '') return '';
  return `\nPERSONAL INSTRUCTIONS:\n${content}\n`;
}
