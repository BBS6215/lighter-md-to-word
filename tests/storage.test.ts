import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultStore, serializeStore } from '../src/core/profiles';
import { importProfiles, readProfiles, writeUniqueDocx } from '../src/cli/storage';

const directories: string[] = [];
async function temporary() { const path = await mkdtemp(join(tmpdir(), 'md2word-test-')); directories.push(path); return path; }
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
describe('safe local file operations', () => {
  it('preserves the old valid configuration on invalid input or interruption before replacement', async () => {
    const path = join(await temporary(), 'profiles.json'), old = defaultStore();
    await importProfiles(path, old);
    const next = defaultStore(); next.profiles[0].settings.paragraph.line = 32;
    await expect(importProfiles(path, { ...next, profiles: [] })).rejects.toThrow();
    await expect(importProfiles(path, next, { beforeReplace() { throw new Error('simulated interruption'); } })).rejects.toThrow('simulated');
    expect(await readFile(path, 'utf8')).toBe(serializeStore(old));
    expect((await readdir(join(path, '..'))).filter(name => name.endsWith('.tmp'))).toEqual([]);
    expect(await importProfiles(path, next)).toEqual(next);
  });
  it('leaves an occupied replacement target intact and returns failure', async () => {
    const root = await temporary(), target = join(root, 'occupied'); await mkdir(target); await writeFile(join(target, 'keep.txt'), 'keep');
    await expect(importProfiles(target, defaultStore())).rejects.toThrow();
    expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('keep');
  });
  it('reserves output names exclusively and never overwrites an existing document', async () => {
    const path = join(await temporary(), '中文 空格.docx'); await writeFile(path, 'existing');
    const next = await writeUniqueDocx(path, new Uint8Array([1, 2, 3]));
    expect(next).toContain('(2).docx'); expect(await readFile(path, 'utf8')).toBe('existing');
    const pair = await Promise.all([writeUniqueDocx(path, new Uint8Array([4])), writeUniqueDocx(path, new Uint8Array([5]))]);
    expect(new Set(pair).size).toBe(2);
  });
  it('uses built-in defaults only when the implicit configuration is absent', async () => {
    const path = join(await temporary(), 'missing.json');
    expect((await readProfiles(path, false)).source).toBe('built-in');
    await expect(readProfiles(path, true)).rejects.toThrow();
    await writeFile(path, 'broken'); await expect(readProfiles(path, false)).rejects.toThrow();
  });
});
