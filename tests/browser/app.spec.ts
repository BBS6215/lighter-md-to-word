import { test, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';
import { parseDocument } from '../../src/core/model';
import { generateWord } from '../../src/core/word';
import { defaultSettings, parseStore } from '../../src/core/profiles';

const root = resolve('.');
const app = pathToFileURL(resolve(root, 'md2word.html')).href;
const normalize = (xml: string) => xml.replace(/r:id="[^"]*"/g, 'r:id="ID"').replace(/w:numId w:val="\d+"/g, 'w:numId w:val="ID"');

test('standalone offline app downloads a real DOCX identical to the shared engine and persists no body', async ({ page }, info) => {
  const network: string[] = [], errors: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.context().setOffline(true);
  await page.goto(app);
  await expect(page.getByRole('button', { name: '导出 Word' })).toBeDisabled();
  const sample = await readFile(resolve(root, 'examples/sample.md'), 'utf8');
  await page.getByRole('textbox', { name: 'Markdown 原文', exact: true }).fill(sample);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Word' }).click();
  const downloaded = await downloadEvent, target = info.outputPath('browser.docx'); await downloaded.saveAs(target);
  const browserZip = unzipSync(new Uint8Array(await readFile(target))), engineZip = unzipSync(await generateWord(parseDocument(sample), defaultSettings()));
  for (const name of ['word/document.xml', 'word/styles.xml', 'word/footer1.xml']) {
    expect(normalize(strFromU8(browserZip[name]))).toBe(normalize(strFromU8(engineZip[name])));
  }
  await expect(page.getByRole('textbox', { name: 'Markdown 原文', exact: true })).toHaveValue(sample);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stored).not.toContain('项目进展说明');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Markdown 原文', exact: true })).toHaveValue('');
  expect(network).toEqual([]); expect(errors).toEqual([]);
});

test('three profiles, browser persistence, JSON handoff and CLI fixed default work from a different directory', async ({ page }, info) => {
  await page.goto(app); await page.getByRole('button', { name: '格式设置' }).click();
  const bodySize = page.getByRole('spinbutton', { name: '正文 字号', exact: true });
  await bodySize.fill('14'); await bodySize.press('Tab');
  await expect(page.locator('#dialog-save-status')).toHaveText('配置已保存');
  await page.getByRole('button', { name: '复制为新配置' }).click();
  await page.getByRole('textbox', { name: '新名称', exact: true }).fill('会议材料');
  await page.getByRole('button', { name: '创建配置', exact: true }).click();
  await bodySize.fill('18'); await bodySize.press('Tab');
  await page.getByRole('button', { name: '复制为新配置' }).click();
  await page.getByRole('textbox', { name: '新名称', exact: true }).fill('工作笔记');
  await page.getByRole('button', { name: '创建配置', exact: true }).click();
  await expect(page.getByRole('button', { name: '复制为新配置' })).toBeDisabled();
  const exportEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 AI 配置（JSON）' }).click();
  const configPath = info.outputPath('profiles.json'); await (await exportEvent).saveAs(configPath);
  const exported = parseStore(await readFile(configPath, 'utf8'));
  expect(exported.profiles).toHaveLength(3); expect(exported.profiles[0].settings.styles.body.size).toBe(14);
  await page.getByRole('button', { name: '完成', exact: true }).click(); await page.reload();
  await expect(page.getByRole('combobox', { name: '排版配置', exact: true })).toHaveValue(exported.profiles[2].id);
  const elsewhere = info.outputPath('different 中文 directory'); await mkdir(elsewhere, { recursive: true });
  const cli = resolve(root, 'build/cli.js');
  const run = (args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: elsewhere, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0); return JSON.parse(result.stdout);
  };
  const defaults = run(['profiles', 'list']);
  expect(defaults.configPath).toBe(resolve(root, '.local/profiles.json'));
  const importedPath = resolve(elsewhere, 'personal profiles.json');
  run(['profiles', 'import', '--input', configPath, '--config', importedPath]);
  const markdown = resolve(elsewhere, '最终 稿.md'); await writeFile(markdown, '# 合成材料\n\n正文。', 'utf8');
  const first = run(['convert', '--input', markdown, '--config', importedPath]);
  expect(first.profile.id).toBe('default');
  const other = run(['convert', '--input', markdown, '--config', importedPath, '--profile', '会议材料']);
  expect(other.profile.name).toBe('会议材料'); expect(other.outputPath).toContain('(2).docx');
  expect(await readFile(markdown, 'utf8')).toBe('# 合成材料\n\n正文。');
  const changed = structuredClone(exported); changed.profiles[0].settings.styles.body.size = 15;
  await writeFile(configPath, JSON.stringify(changed));
  run(['profiles', 'import', '--input', configPath, '--config', importedPath]);
  const updated = run(['convert', '--input', markdown, '--config', importedPath]);
  const xml = strFromU8(unzipSync(new Uint8Array(await readFile(updated.outputPath)))['word/document.xml']);
  expect(xml).toContain('w:sz w:val="30"');
});

test('clear undo is invalidated by new input and unsafe or unsupported content never makes a network request', async ({ page }) => {
  const attempts: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) attempts.push(request.url()); });
  await page.goto(app);
  const input = page.getByRole('textbox', { name: 'Markdown 原文', exact: true });
  await input.fill('# 合成稿\n\n![图片](https://example.invalid/picture.png)\n\n<script>window.privateLeak=1</script>');
  await expect(page.locator('#conversion-warnings')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { privateLeak?: number }).privateLeak)).toBeUndefined();
  await page.getByRole('button', { name: '清除', exact: true }).click();
  await page.getByRole('button', { name: '撤销清除' }).click();
  await expect(input).toHaveValue(/合成稿/);
  await page.getByRole('button', { name: '清除', exact: true }).click(); await input.fill('新的正文');
  await expect(page.getByRole('button', { name: '撤销清除' })).toBeHidden();
  expect(attempts).toEqual([]);
});

test('disabled storage still permits Word and configuration download, and font denial is recoverable', async ({ page }, info) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('blocked', 'SecurityError'); };
    Object.defineProperty(window, 'queryLocalFonts', { value: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) });
  });
  await page.goto(app); await page.getByRole('button', { name: '格式设置' }).click();
  await page.getByRole('spinbutton', { name: '正文 字号', exact: true }).fill('15');
  await page.getByRole('spinbutton', { name: '正文 字号', exact: true }).press('Tab');
  await expect(page.locator('#storage-status')).toContainText('保存失败');
  await page.getByRole('button', { name: '检测本机字体' }).click();
  await expect(page.locator('#font-status')).toContainText('未取得');
  const configEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 AI 配置（JSON）' }).click();
  await (await configEvent).saveAs(info.outputPath('backup.json'));
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('textbox', { name: 'Markdown 原文', exact: true }).fill('# 临时正文\n\n仍可转换');
  const wordEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 Word' }).click();
  await (await wordEvent).saveAs(info.outputPath('without-storage.docx'));
});

test('file import, mobile layout and a document larger than 200 KiB retain all content', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(app);
  await page.locator('#markdown-file').setInputFiles(resolve(root, 'examples/sample.md'));
  await expect(page.getByRole('textbox', { name: 'Markdown 原文', exact: true })).toHaveValue(/项目进展说明/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1366, height: 1000 });
  const long = '# 长文验证\n\n' + '这是用于验证完整导出的合成正文。\n\n'.repeat(5000) + '尾部验收标记';
  await page.locator('#markdown-file').setInputFiles({ name: '长文.md', mimeType: 'text/markdown', buffer: Buffer.from(long) });
  await expect(page.locator('#markdown')).toHaveValue(long);
  await page.evaluate(text => {
    const clipboard = new DataTransfer(); clipboard.setData('text/plain', text);
    const input = document.querySelector<HTMLTextAreaElement>('#markdown')!;
    input.select();
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  }, long);
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 Word' }).click();
  const target = info.outputPath('long.docx'); await (await event).saveAs(target);
  expect(strFromU8(unzipSync(new Uint8Array(await readFile(target)))['word/document.xml'])).toContain('尾部验收标记');
});
