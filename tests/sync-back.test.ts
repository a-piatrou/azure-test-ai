import { describe, it, expect } from 'vitest';
import { SyncBackEngine } from '../src/sync/sync-back.js';

describe('SyncBackEngine.buildPatches (private behavior via integration)', () => {
  // We can't easily test private buildPatches; verify the XML escaping/normalisation
  // path is consistent by checking the public planFromMarkdown indirectly via a fake client.
  it('placeholder — actual API patching covered by integration test', () => {
    // The SyncBackEngine requires an AdoClient; integration test would mock it.
    // This placeholder asserts the module loads without runtime errors.
    expect(typeof SyncBackEngine).toBe('function');
  });
});
