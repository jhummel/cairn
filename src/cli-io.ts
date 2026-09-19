/** Minimal output sink injected into CLI command handlers so tests can capture output. */
export type Writer = { write: (chunk: string) => void };

export function defaultStdout(): Writer {
  return { write: (chunk) => process.stdout.write(chunk) };
}

export function defaultStderr(): Writer {
  return { write: (chunk) => process.stderr.write(chunk) };
}
