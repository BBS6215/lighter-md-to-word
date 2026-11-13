import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from '../core/model';
import { parseStore, selectProfile } from '../core/profiles';
import { generateWord } from '../core/word';
import { importProfiles, readProfiles, writeUniqueDocx } from './storage';
import { version } from '../../package.json';

const HELP = `Lighter · MD to Word ${version} (md2word) — offline Markdown to Word

convert --input <final.md> [--output <document.docx>] [--profile <id-or-name>] [--config <profiles.json>]
profiles list [--config <profiles.json>]
profiles import --input <exported-profiles.json> [--config <destination.json>]

The default profile is always "default". Outputs never overwrite existing DOCX files.
Personal profiles default to <tool-root>/.local/profiles.json, independent of working directory.
Successful commands return JSON to stdout; errors return JSON to stderr with a nonzero exit code.
The standalone HTML app needs no Node.js. This CLI requires Node.js >=22.12.
`;
function options(args: string[], allowed: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!allowed.includes(key) || !args[i + 1] || args[i + 1].startsWith('--') || result[key] !== undefined) throw new Error(`参数无效或重复：${key}。使用 --help 查看用法`);
    result[key] = args[i + 1];
  }
  return result;
}
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) { process.stdout.write(HELP); return; }
  if (args.length === 1 && args[0] === '--version') { process.stdout.write(version + '\n'); return; }
  const command = args[0], action = command === 'profiles' ? args[1] : undefined;
  if (command !== 'convert' && !(command === 'profiles' && action && ['list', 'import'].includes(action))) throw new Error('未知命令，使用 --help 查看用法');
  const flags = options(args.slice(command === 'profiles' ? 2 : 1), command === 'convert' ? ['--input', '--output', '--profile', '--config'] : action === 'import' ? ['--input', '--config'] : ['--config']);
  const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const configPath = flags['--config'] ? resolve(flags['--config']) : resolve(toolRoot, '.local', 'profiles.json');
  if (action === 'import') {
    if (!flags['--input']) throw new Error('配置导入需要 --input');
    const source = parseStore(await readFile(resolve(flags['--input']), 'utf8'));
    const confirmed = await importProfiles(configPath, source);
    output({ ok: true, configPath, profiles: confirmed.profiles.map(({ id, name }) => ({ id, name })) }); return;
  }
  const profiles = await readProfiles(configPath, !!flags['--config']);
  if (action === 'list') {
    output({ ok: true, configPath, source: profiles.source, defaultProfile: 'default', profiles: profiles.store.profiles.map(({ id, name }) => ({ id, name })), warnings: profiles.warnings }); return;
  }
  if (!flags['--input']) throw new Error('转换需要 --input 指定最终 Markdown 文件');
  const inputPath = resolve(flags['--input']);
  if (!['.md', '.markdown', '.txt'].includes(extname(inputPath).toLowerCase())) throw new Error('输入文件应为 .md、.markdown 或 .txt');
  const raw = await readFile(inputPath);
  let markdown: string;
  try { markdown = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { throw new Error('输入不是有效 UTF-8 文本，请先另存为 UTF-8'); }
  if (!markdown.trim()) throw new Error('输入文件没有可转换的正文');
  const profile = selectProfile(profiles.store, flags['--profile']);
  const model = parseDocument(markdown);
  const requested = flags['--output'] ? resolve(flags['--output']) : resolve(dirname(inputPath), basename(inputPath, extname(inputPath)) + '.docx');
  const bytes = await generateWord(model, profile.settings);
  const outputPath = await writeUniqueDocx(requested, bytes);
  output({ ok: true, outputPath, profile: { id: profile.id, name: profile.name }, configPath, configSource: profiles.source, stats: model.stats, warnings: [...profiles.warnings, ...model.warnings] });
}
function output(value: unknown): void { process.stdout.write(JSON.stringify(value) + '\n'); }
main().catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : '转换失败' }) + '\n');
  process.exitCode = 1;
});
