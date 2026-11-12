import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { defaultSettings, defaultStore } from '../../src/core/profiles';
import { parseDocument } from '../../src/core/model';
import { generateWord } from '../../src/core/word';

const app = pathToFileURL(resolve('md2word.html')).href;
const profileKey = 'md2word.profiles.v1';
async function bodySize(page: Page) { return page.locator('[data-path="styles.body.size"]').inputValue(); }
async function delayFirstConfig(page: Page) {
  await page.addInitScript(() => {
    const original = File.prototype.text;
    const gate = window as unknown as { releaseConfig: (() => void) | undefined };
    File.prototype.text = async function () {
      const value = await original.call(this);
      if (this.name === 'A.json') await new Promise<void>(resolve => { gate.releaseConfig = resolve; });
      return value;
    };
  });
  await page.goto(app);
}
async function importSize(page: Page, name: string, size: number | 'invalid') {
  const store = defaultStore(); store.profiles[0].settings.styles.body.size = typeof size === 'number' ? size : 16;
  await page.locator('#profiles-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(size === 'invalid' ? '{broken' : JSON.stringify(store)) });
}
async function releaseFirstConfig(page: Page) {
  await page.waitForFunction(() => typeof (window as unknown as { releaseConfig?: unknown }).releaseConfig === 'function');
  await page.evaluate(async () => {
    (window as unknown as { releaseConfig: () => void }).releaseConfig();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
}

for (const mode of ['picker', 'drop'] as const) for (const readFails of [false, true]) {
  test(`invalid Markdown ${mode} selection discards an earlier ${readFails ? 'failed' : 'successful'} read`, async ({ page }) => {
    await page.addInitScript(fails => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = async function () {
        const bytes = await original.call(this);
        if (this.name === 'A.md') await new Promise<void>((resolve, reject) => {
          (window as unknown as { finishMarkdownRead: () => void }).finishMarkdownRead = () => fails ? reject(new Error('Synthetic read failure')) : resolve();
        });
        return bytes;
      };
    }, readFails);
    await page.goto(app);
    const text = '# 当前稿C\n\n保留正文C';
    await page.locator('#markdown').fill(text); await expect(page.locator('#preview-content')).toContainText('保留正文C');
    await page.locator('#filename').fill('当前文稿C');
    await page.locator('#markdown-file').setInputFiles({ name: 'A.md', mimeType: 'text/markdown', buffer: Buffer.from('# 旧稿A\n\n不应替换的正文') });
    await page.waitForFunction(() => typeof (window as unknown as { finishMarkdownRead?: unknown }).finishMarkdownRead === 'function');
    if (mode === 'picker') {
      await page.locator('#markdown-file').setInputFiles({ name: 'B.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid') });
    } else {
      await page.evaluate(() => {
        const data = new DataTransfer(); data.items.add(new File(['invalid'], 'B.exe', { type: 'application/octet-stream' }));
        document.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
      });
    }
    await expect(page.locator('#app-message')).toContainText('请选择 .md');
    await page.evaluate(async () => {
      (window as unknown as { finishMarkdownRead: () => void }).finishMarkdownRead();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    });
    await expect(page.locator('#markdown')).toHaveValue(text);
    await expect(page.locator('#filename')).toHaveValue('当前文稿C');
    await expect(page.locator('#preview-content')).toContainText('保留正文C');
    await expect(page.locator('#app-message')).toContainText('请选择 .md');
    await page.locator('#markdown-file').setInputFiles({ name: 'D.md', mimeType: 'text/markdown', buffer: Buffer.from('# 新稿D\n\n新的合法正文') });
    await expect(page.locator('#preview-content')).toContainText('新的合法正文');
    await expect(page.locator('#filename')).toHaveValue('新稿D');
    const download = page.waitForEvent('download'); await page.locator('#export-word').click();
    expect((await download).suggestedFilename()).toBe('新稿D.docx');
  });
}

test('failed parsing discards the previous preview and prevents stale downloads, then recovers', async ({ page }) => {
  await page.goto(app); await page.locator('#markdown').fill('# 旧稿A\n\n旧正文');
  await expect(page.locator('#preview-content')).toContainText('旧稿A');
  const downloads: string[] = []; page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.evaluate(() => { const input = document.querySelector<HTMLTextAreaElement>('#markdown')!; input.value = '> '.repeat(12000) + '新正文B'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#app-message')).toContainText('解析失败');
  await expect(page.locator('#preview-content')).toBeEmpty();
  await expect(page.locator('#export-word')).toBeDisabled();
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#export-word')!.click());
  expect(downloads).toEqual([]);
  await page.locator('#markdown').fill('# 修正后的B\n\n新正文B');
  const event = page.waitForEvent('download'); await page.locator('#export-word').click();
  const download = await event;
  expect(download.suggestedFilename()).toBe('修正后的B.docx');
  const xml = strFromU8(unzipSync(new Uint8Array(await readFile((await download.path())!)))['word/document.xml']);
  expect(xml).toContain('新正文B'); expect(xml).not.toContain('旧正文');
});

for (const invalidNext of [false, true]) test(`export snapshot survives concurrent edits; next parse invalid=${invalidNext}`, async ({ page }) => {
  await page.goto(app);
  const event = page.waitForEvent('download');
  await page.evaluate(invalid => {
    const editor = document.querySelector<HTMLTextAreaElement>('#markdown')!;
    editor.value = '# 文档A\n\n' + '合成正文A。\n\n'.repeat(100); editor.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('#export-word')!.click();
    document.querySelector<HTMLButtonElement>('#settings-button')!.click();
    const size = document.querySelector<HTMLInputElement>('[data-path="styles.body.size"]')!;
    size.value = '18'; size.dispatchEvent(new Event('input', { bubbles: true })); size.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('#done-settings')!.click();
    editor.value = invalid ? '> '.repeat(12000) + '新文档B' : '# 文档B\n\n合成正文B。';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    const filename = document.querySelector<HTMLInputElement>('#filename')!; filename.value = '文档B'; filename.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('compositionend', { bubbles: true }));
  }, invalidNext);
  const download = await event; expect(download.suggestedFilename()).toBe('文档A.docx');
  const xml = strFromU8(unzipSync(new Uint8Array(await readFile((await download.path())!)))['word/document.xml']);
  expect(xml).toContain('文档A'); expect(xml).not.toContain('文档B');
  expect(xml).toContain('w:sz w:val="32"'); expect(xml).not.toContain('w:sz w:val="36"');
  await expect(page.locator('[data-path="styles.body.size"]')).toHaveValue('18');
  if (invalidNext) { await expect(page.locator('#app-message')).toContainText('解析失败'); await expect(page.locator('#export-word')).toBeDisabled(); }
});

for (const close of ['button', 'escape']) test(`invalid settings draft is discarded on ${close} without losing legal edits`, async ({ page }) => {
  await page.goto(app); await page.locator('#markdown').fill('# 合成稿\n\n正文'); await page.locator('#settings-button').click();
  const size = page.locator('[data-path="styles.body.size"]'); await size.fill('14'); await size.press('Tab');
  await size.fill(''); await size.press('Tab'); await expect(page.locator('#settings-error')).toBeVisible();
  if (close === 'button') await page.locator('#close-settings').click(); else await page.keyboard.press('Escape');
  await page.locator('#settings-button').click(); expect(await bodySize(page)).toBe('14'); await expect(page.locator('#settings-error')).toBeHidden();
  const configEvent = page.waitForEvent('download'); await page.locator('#export-profiles').click(); await configEvent;
  await page.locator('#done-settings').click(); await expect(page.locator('#settings-dialog')).not.toBeVisible();
  const wordEvent = page.waitForEvent('download'); await page.locator('#export-word').click(); await wordEvent;
});

test('a slower earlier configuration cannot override a later valid import', async ({ page }) => {
  await delayFirstConfig(page); await importSize(page, 'A.json', 14); await importSize(page, 'B.json', 18);
  await expect(page.locator('[data-path="styles.body.size"]')).toHaveValue('18'); await releaseFirstConfig(page);
  expect(await bodySize(page)).toBe('18');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).profiles[0].settings.styles.body.size, profileKey)).toBe(18);
});
test('a newer invalid import retains the old legal configuration instead of accepting an older pending read', async ({ page }) => {
  await delayFirstConfig(page); await importSize(page, 'A.json', 14); await importSize(page, 'B.json', 'invalid');
  await expect(page.locator('#settings-error')).toContainText('JSON'); await releaseFirstConfig(page);
  expect(await bodySize(page)).toBe('16'); await expect(page.locator('#settings-error')).toContainText('JSON');
});
test('manual configuration edits invalidate an outstanding import', async ({ page }) => {
  await delayFirstConfig(page); await importSize(page, 'A.json', 14); await page.locator('#settings-button').click();
  const size = page.locator('[data-path="styles.body.size"]'); await size.fill('18'); await size.press('Tab'); await releaseFirstConfig(page);
  expect(await bodySize(page)).toBe('18');
});
test('an older invalid read cannot replace a newer successful import with an error', async ({ page }) => {
  await delayFirstConfig(page); await importSize(page, 'A.json', 'invalid'); await importSize(page, 'B.json', 18);
  await expect(page.locator('[data-path="styles.body.size"]')).toHaveValue('18'); await releaseFirstConfig(page);
  expect(await bodySize(page)).toBe('18'); await expect(page.locator('#settings-error')).toBeHidden();
});

test('no-H1 imports keep their basename and empty or reserved names are normalized by the app', async ({ page }) => {
  await page.goto(app); await page.locator('#markdown-file').setInputFiles({ name: 'Plain Notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Only body.') });
  const first = page.waitForEvent('download'); await page.locator('#export-word').click(); expect((await first).suggestedFilename()).toBe('Plain Notes.docx');
  await page.locator('#clear-button').click(); await page.locator('#markdown').fill('纯正文');
  for (const [input, expected] of [['.docx', 'document.docx'], ['CON.docx', 'document-CON.docx'], ['中文 空格.docx.docx', '中文 空格.docx']]) {
    await page.locator('#filename').fill(input); const event = page.waitForEvent('download'); await page.locator('#export-word').click(); expect((await event).suggestedFilename()).toBe(expected);
  }
});

test('all XML and relationship parts parse strictly and browser exports reject invalid characters', async ({ page }) => {
  await page.goto(app);
  const model = parseDocument('# 合成😀材料\n\n中文\t正文\n\n[链接](https://example.invalid/?a=1&b=2)\n\n0. [ ] 首项');
  const zip = unzipSync(await generateWord(model, defaultSettings()));
  const parts = Object.entries(zip).filter(([name]) => /\.(xml|rels)$/.test(name)).map(([name, bytes]) => ({ name, xml: strFromU8(bytes) }));
  const invalid = await page.evaluate(parts => parts.filter(part => new DOMParser().parseFromString(part.xml, 'application/xml').querySelector('parsererror')).map(part => part.name), parts);
  expect(invalid).toEqual([]);
  await page.evaluate(() => { const input = document.querySelector<HTMLTextAreaElement>('#markdown')!; input.value = '前文\u0001后文'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#app-message')).toContainText('U+0001'); await expect(page.locator('#export-word')).toBeDisabled();
});
