import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import packageInfo from '../package.json';
import { defaultStore } from '../src/core/profiles';
import { unzipSync } from 'fflate';

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

async function portable() {
  const root = await folder(), tool = join(root, 'Lighter 工具'), elsewhere = join(root, 'another working directory');
  await mkdir(join(tool, 'cli'), { recursive: true }); await mkdir(elsewhere);
  const files = unzipSync(new Uint8Array(await readFile(resolve('downloads/lighter-md-to-word-cli.zip'))));
  expect(Object.keys(files).sort()).toEqual(['LICENSE', 'README.txt', 'THIRD_PARTY_LICENSES.txt', 'THIRD_PARTY_NOTICES.md', 'cli/md2word.mjs', 'md2word.cmd'].sort());
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(tool, name), bytes);
  const input = join(elsewhere, '合成 最终稿.md');
  await writeFile(input, '# 合成最终稿\n\n预打包 CLI 不需要源码或开发依赖。😀');
  return { tool, elsewhere, input };
}

describe('prebuilt CLI distribution without source, package.json or node_modules', () => {
  it('runs from an isolated copy, uses the tool root, preserves source and existing Word, and reports errors', async () => {
    const { tool, elsewhere, input } = await portable(), entry = join(tool, 'cli/md2word.mjs');
    const run = (args: string[]) => spawnSync(process.execPath, [entry, ...args], { cwd: elsewhere, encoding: 'utf8' });
    const first = run(['convert', '--input', input]); expect(first.status, first.stderr).toBe(0);
    const result = JSON.parse(first.stdout); expect(result).toMatchObject({ ok: true, profile: { id: 'default' }, configSource: 'built-in', configPath: join(tool, '.local/profiles.json') });
    const bytes = await readFile(result.outputPath); expect(bytes.length).toBeGreaterThan(1000);
    const second = run(['convert', '--input', input]); expect(second.status).toBe(0);
    expect(JSON.parse(second.stdout).outputPath).toContain('(2).docx'); expect(await readFile(result.outputPath)).toEqual(bytes);
    expect(await readFile(input, 'utf8')).toBe('# 合成最终稿\n\n预打包 CLI 不需要源码或开发依赖。😀');
    const invalid = run(['convert', '--input', input, '--profile', 'not-a-profile']); expect(invalid.status).not.toBe(0);
    expect(invalid.stdout).toBe(''); expect(JSON.parse(invalid.stderr)).toMatchObject({ ok: false });
    expect(run(['--help']).stdout).toContain('Lighter · MD to Word');
  });
  it.skipIf(process.platform !== 'win32')('Windows wrapper forwards Chinese/space paths from another working directory', async () => {
    const { tool, elsewhere, input } = await portable();
    const command = '& ' + [join(tool, 'md2word.cmd'), 'convert', '--input', input].map(value => `'${value.replaceAll("'", "''")}'`).join(' ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd: elsewhere, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0); const json = JSON.parse(result.stdout);
    expect(json.ok).toBe(true); expect(json.profile.id).toBe('default'); await expect(access(json.outputPath)).resolves.toBeUndefined();
  });
});
