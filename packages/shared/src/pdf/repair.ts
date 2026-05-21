// qpdf-backed repair pass for source PDFs that pdf-lib refuses to parse.
//
// In production the Fly worker image installs `qpdf` so this is a real
// fallback. In environments without `qpdf` installed, `repairPdfWithQpdf`
// rejects with a clear error and the caller can surface a
// `processing_error` instead of crashing the whole export.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type QpdfRepairOptions = {
  /** Absolute path or PATH-resolvable name of the qpdf binary. */
  binary?: string;
  /** Timeout in milliseconds before the spawn is killed. */
  timeoutMs?: number;
};

export class QpdfNotInstalledError extends Error {
  constructor(binary: string, cause?: unknown) {
    super(`qpdf binary "${binary}" not available on PATH`);
    this.name = 'QpdfNotInstalledError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export class QpdfRepairFailedError extends Error {
  constructor(message: string, public readonly exitCode: number | null) {
    super(message);
    this.name = 'QpdfRepairFailedError';
  }
}

export async function repairPdfWithQpdf(
  bytes: Uint8Array,
  options: QpdfRepairOptions = {},
): Promise<Uint8Array> {
  const binary = options.binary ?? 'qpdf';
  const timeoutMs = options.timeoutMs ?? 30_000;

  const dir = await mkdtemp(path.join(tmpdir(), 'submittal-qpdf-'));
  const inputPath = path.join(dir, 'in.pdf');
  const outputPath = path.join(dir, 'out.pdf');

  try {
    await writeFile(inputPath, bytes);

    await new Promise<void>((resolve, reject) => {
      let child;
      try {
        child = spawn(binary, ['--linearize', inputPath, outputPath]);
      } catch (err) {
        reject(new QpdfNotInstalledError(binary, err));
        return;
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new QpdfRepairFailedError(`qpdf timed out after ${timeoutMs}ms`, null));
      }, timeoutMs);
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT') reject(new QpdfNotInstalledError(binary, err));
        else reject(err);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        // qpdf exit code 0 = ok, 3 = warnings (still writes output).
        if (code === 0 || code === 3) resolve();
        else reject(new QpdfRepairFailedError(stderr.trim() || `qpdf exited with ${code}`, code));
      });
    });

    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
