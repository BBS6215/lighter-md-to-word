import { randomUUID } from 'node:crypto';
import { dirname, extname, resolve, basename } from 'node:path';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { defaultStore, parseStore, serializeStore, validateStore, type ProfileStore } from '../core/profiles';

export async function readProfiles(path: string, explicit: boolean): Promise<{ store: ProfileStore; source: 'file' | 'built-in'; warnings: string[] }> {
  try { return { store: parseStore(await readFile(path, 'utf8')), source: 'file', warnings: [] }; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !explicit) return { store: defaultStore(), source: 'built-in', warnings: ['尚未导入个人配置，使用内置默认配置。'] };
    throw new Error(`无法读取配置 ${path}：${error instanceof Error ? error.message : '读取失败'}`);
  }
}
export async function importProfiles(path: string, value: unknown, hooks: { beforeReplace?: () => void | Promise<void> } = {}): Promise<ProfileStore> {
  const store = validateStore(value), text = serializeStore(store), parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const temporary = resolve(parent, `.profiles-${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(text, 'utf8'); await file.sync(); } finally { await file.close(); }
    await hooks.beforeReplace?.();
    // Same-directory rename replaces a complete file. Never remove the old target first.
    await rename(temporary, path);
    const confirmed = parseStore(await readFile(path, 'utf8'));
    if (serializeStore(confirmed) !== text) throw new Error('配置回读不一致，请检查是否有其他导入正在执行');
    return confirmed;
  } finally {
    await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  }
}
export async function writeUniqueDocx(requested: string, bytes: Uint8Array): Promise<string> {
  if (extname(requested).toLowerCase() !== '.docx') throw new Error('输出文件必须使用 .docx 扩展名');
  await mkdir(dirname(requested), { recursive: true });
  const stem = basename(requested, extname(requested));
  for (let index = 0; index < 10000; index++) {
    const path = index ? resolve(dirname(requested), `${stem} (${index + 1}).docx`) : requested;
    let file;
    try { file = await open(path, 'wx'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw error; }
    try { await file.writeFile(bytes); await file.sync(); await file.close(); return path; }
    catch (error) { await file.close().catch(() => undefined); await unlink(path).catch(() => undefined); throw error; }
  }
  throw new Error('同名文件过多，请指定新的输出名称');
}
