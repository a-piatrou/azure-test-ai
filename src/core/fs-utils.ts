import { mkdir, writeFile, readFile, unlink, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import fg from 'fast-glob';

export async function writeFileEnsured(filePath: string, contents: string | Buffer): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

export async function readFileIfExists(filePath: string): Promise<string | null> {
  if (!existsSync(filePath)) return null;
  return readFile(filePath, 'utf8');
}

export async function safeDelete(filePath: string): Promise<void> {
  if (!existsSync(filePath)) return;
  await unlink(filePath);
}

export async function safeDeleteDir(dirPath: string): Promise<void> {
  if (!existsSync(dirPath)) return;
  await rm(dirPath, { recursive: true, force: true });
}

export async function listMarkdown(dir: string, pattern = '**/*.md'): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return fg(pattern, { cwd: dir, dot: false, absolute: true });
}

export async function fileSize(filePath: string): Promise<number> {
  try {
    const s = await stat(filePath);
    return s.size;
  } catch {
    return 0;
  }
}

export function relativeFrom(root: string, target: string): string {
  return relative(resolve(root), resolve(target)).replace(/\\/g, '/');
}
