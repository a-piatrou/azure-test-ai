import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { SyncStateError } from './errors.js';
import { syncStateFile } from './paths.js';
import type { SyncState } from './types.js';

export async function loadSyncState(outputDir: string): Promise<SyncState | null> {
  const path = syncStateFile(outputDir);
  if (!existsSync(path)) return null;
  try {
    const text = await readFile(path, 'utf8');
    const parsed = JSON.parse(text) as SyncState;
    if (parsed.version !== 1) {
      throw new SyncStateError(
        `Unsupported sync state version: ${parsed.version}`,
        'Delete .sync-state.json or run with --full to start fresh',
      );
    }
    return parsed;
  } catch (err) {
    if (err instanceof SyncStateError) throw err;
    throw new SyncStateError(
      `Failed to read sync state: ${(err as Error).message}`,
      'You can delete .sync-state.json to start fresh',
    );
  }
}

export async function saveSyncState(outputDir: string, state: SyncState): Promise<void> {
  const path = syncStateFile(outputDir);
  await mkdir(dirname(path), { recursive: true });
  const text = JSON.stringify(state, null, 2);
  await writeFile(path, text, 'utf8');
}

export function emptySyncState(organization: string): SyncState {
  return {
    version: 1,
    lastSyncAt: new Date(0).toISOString(),
    organization,
    projects: {},
  };
}
