import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import packageInfo from '../package.json';
import { defaultStore } from '../src/core/profiles';

const directories: string[] = [];
const cli = resolve('build/cli.js');
async function folder() { const path = await mkdtemp(join(tmpdir(), 'md2word-cli-')); directories.push(path); return path; }
afterEach(async () => {
  for (const path of directories.splice(0)) {
    if (dirname(resolve(path)) !== resolve(tmpdir()) || !basename(path).startsWith('md2word-cli-')) throw new Error('Refusing cleanup outside the test directory');
    await rm(path, { recursive: true, force: true });
  }
});

describe('built CLI behavior', () => {
  it('reports the package version consistently', () => {
    const result = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
    expect(result.status).toBe(0); expect(result.stdout.trim()).toBe(packageInfo.version);
  });
  it('rejects valid UTF-8 containing forbidden XML characters without creating DOCX or modifying MD', async () => {
    const root = await folder(), input = join(root, '中文 最终.md'), output = join(root, '结果.docx');
    const text = '# 合成材料\n\n前文\u0001后文'; await writeFile(input, text, 'utf8');
    const config = join(root, 'profiles.json'); await writeFile(config, JSON.stringify(defaultStore()));
    const result = spawnSync(process.execPath, [cli, 'convert', '--input', input, '--output', output, '--config', config], { cwd: root, encoding: 'utf8' });
    expect(result.status).not.toBe(0); expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({ ok: false }); expect(result.stderr).toContain('U+0001');
    await expect(access(output)).rejects.toMatchObject({ code: 'ENOENT' }); expect(await readFile(input, 'utf8')).toBe(text);
    expect(result.stderr).not.toContain('前文');
  });
});
