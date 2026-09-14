export interface CairnConfig {
  projectName: string;
  projectDescription: string;
  healthCheck: string;
  defaultTestCommand: string;
  implementationFile: string;
  truncateText: boolean;
  summarize: { claudeMdPattern: string };
  narration: {
    enabled: boolean;
    voice: string;
    ntfyTopic: string;
  };
  review?: { postTask: boolean };
}

export interface Task {
  id: number;
  priority: number;
  title: string;
  description?: string;
  directory?: string;
  status: 'pending' | 'in-progress' | 'complete' | 'blocked';
  files?: string[];
  tests?: string[];
  completedAt?: string;
  completedBy?: string;
  notes?: string;
  dependencies?: number[];
  model?: 'opus' | 'sonnet';
  agent?: string;
}

export interface AgentInfo {
  name: string;
  description: string;
  model: string;
  file: string;
  internal?: boolean;
}

export function isValidConfig(data: unknown): data is CairnConfig {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;

  if (typeof d.projectName !== 'string') return false;
  if (typeof d.projectDescription !== 'string') return false;
  if (typeof d.healthCheck !== 'string') return false;
  if (typeof d.defaultTestCommand !== 'string') return false;
  if (typeof d.implementationFile !== 'string') return false;
  if (typeof d.truncateText !== 'boolean') return false;

  if (typeof d.summarize !== 'object' || d.summarize === null) return false;
  const summarize = d.summarize as Record<string, unknown>;
  if (typeof summarize.claudeMdPattern !== 'string') return false;

  if (typeof d.narration !== 'object' || d.narration === null) return false;
  const narration = d.narration as Record<string, unknown>;
  if (typeof narration.enabled !== 'boolean') return false;
  if (typeof narration.voice !== 'string') return false;
  if (typeof narration.ntfyTopic !== 'string') return false;

  if (d.review !== undefined) {
    if (typeof d.review !== 'object' || d.review === null) return false;
    const review = d.review as Record<string, unknown>;
    if (typeof review.postTask !== 'boolean') return false;
    // review.maxIterations is a dead legacy key (no longer read anywhere); if present it's
    // ignored, not validated, so existing configs that still have it keep loading cleanly.
  }

  return true;
}

export function isValidTask(data: unknown): data is Task {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;

  if (typeof d.id !== 'number') return false;
  if (typeof d.priority !== 'number') return false;
  if (typeof d.title !== 'string') return false;

  const validStatuses = ['pending', 'in-progress', 'complete', 'blocked'];
  if (typeof d.status !== 'string' || !validStatuses.includes(d.status)) return false;

  if (d.description !== undefined && typeof d.description !== 'string') return false;
  if (d.directory !== undefined && typeof d.directory !== 'string') return false;
  if (d.completedAt !== undefined && typeof d.completedAt !== 'string') return false;
  if (d.completedBy !== undefined && typeof d.completedBy !== 'string') return false;
  if (d.notes !== undefined && typeof d.notes !== 'string') return false;
  if (d.agent !== undefined && typeof d.agent !== 'string') return false;

  const validModels = ['opus', 'sonnet'];
  if (d.model !== undefined && (typeof d.model !== 'string' || !validModels.includes(d.model))) return false;

  if (d.files !== undefined) {
    if (!Array.isArray(d.files) || !d.files.every((f) => typeof f === 'string')) return false;
  }
  if (d.tests !== undefined) {
    if (!Array.isArray(d.tests) || !d.tests.every((t) => typeof t === 'string')) return false;
  }
  if (d.dependencies !== undefined) {
    if (!Array.isArray(d.dependencies) || !d.dependencies.every((dep) => typeof dep === 'number')) return false;
  }

  return true;
}
