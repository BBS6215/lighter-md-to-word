import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const app = pathToFileURL(resolve('md2word.html')).href;
test('an in-flight export cannot replace a newer file-selection error with success', async ({ page }) => {
  await page.goto(app);
  const download = page.waitForEvent('download');
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLTextAreaElement>('#markdown')!;
    editor.value = '# 文稿A\n\n' + '合成正文。\n\n'.repeat(120); editor.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('#export-word')!.click();
    const data = new DataTransfer(); data.items.add(new File(['bad'], 'B.exe'));
    const input = document.querySelector<HTMLInputElement>('#markdown-file')!; input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect((await download).suggestedFilename()).toBe('文稿A.docx');
  await expect(page.locator('#app-message')).toContainText('请选择'); await expect(page.locator('#app-message')).toHaveClass(/error/);
});
test('sync preference stays separate from Word JSON, survives reload, and single column suspends it', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 }); await page.goto(app);
  await page.locator('#markdown').fill('# 开关\n\n' + '合成段落。\n\n'.repeat(120));
  await expect(page.locator('#preview-viewport')).toHaveAttribute('data-sync-state', 'ready');
  await page.getByRole('button', { name: '同步滚动', exact: true }).click();
  const top = await page.locator('#preview-viewport').evaluate(e => e.scrollTop);
  await page.locator('#markdown').evaluate(e => { e.scrollTop = 500; });
  await page.waitForTimeout(120); expect(await page.locator('#preview-viewport').evaluate(e => e.scrollTop)).toBe(top);
  await page.reload(); await expect(page.locator('#sync-scroll')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#markdown')).toHaveValue('');
  await page.getByRole('button', { name: '同步滚动', exact: true }).click();
  await page.locator('#markdown').fill('手机正文\n\n'.repeat(100));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#preview-viewport')).toHaveAttribute('data-sync-state', 'off');
  expect(await page.evaluate(() => localStorage.getItem('md2word.sync-scroll.v1'))).toBe('true');
  await page.setViewportSize({ width: 1366, height: 900 });
  await expect(page.locator('#preview-viewport')).toHaveAttribute('data-sync-state', 'ready');
  await page.getByRole('button', { name: '格式设置', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 AI 配置（JSON）' }).click();
  const file = await download;
  const { readFile } = await import('node:fs/promises'); const json = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(Object.keys(json).sort()).toEqual(['profiles', 'schemaVersion']);
  expect(JSON.stringify(json)).not.toContain('手机正文'); expect(JSON.stringify(json)).not.toContain('sync-scroll');
});

test('nested drag feedback clears on drop and imports through the existing last-choice path', async ({ page }) => {
  await page.goto(app);
  await page.evaluate(() => {
    const data = new DataTransfer(); data.items.add(new File(['# 拖入稿\n\n正文'], '拖入.md', { type: 'text/markdown' }));
    (window as unknown as { dragData: DataTransfer }).dragData = data;
    const box = document.querySelector('#markdown')!;
    for (const name of ['dragenter', 'dragenter', 'dragleave']) box.dispatchEvent(new DragEvent(name, { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#drop-hint')).toBeVisible();
  await page.evaluate(() => document.querySelector('#markdown')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: (window as unknown as { dragData: DataTransfer }).dragData })));
  await expect(page.locator('#drop-hint')).toBeHidden(); await expect(page.locator('#markdown')).toHaveValue('# 拖入稿\n\n正文');
});

test('an old success expiry cannot clear a newer error, while current success does expire', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.setTimeout.bind(window), callbacks: (() => void)[] = [];
    (window as unknown as { expiries: (() => void)[] }).expiries = callbacks;
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 4500 && typeof handler === 'function') { callbacks.push(() => handler(...args)); return original(() => {}, 100000); }
      return original(handler, delay, ...args);
    }) as typeof window.setTimeout;
  });
  await page.goto(app);
  await page.locator('#markdown-file').setInputFiles({ name: 'A.md', mimeType: 'text/markdown', buffer: Buffer.from('# 成功稿') });
  await expect(page.locator('#app-message')).toContainText('已导入');
  await page.locator('#markdown-file').setInputFiles({ name: 'bad.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('bad') });
  await page.evaluate(() => (window as unknown as { expiries: (() => void)[] }).expiries.forEach(callback => callback()));
  await expect(page.locator('#app-message')).toBeVisible(); await expect(page.locator('#app-message')).toContainText('请选择');
  await page.locator('#markdown-file').setInputFiles({ name: 'B.md', mimeType: 'text/markdown', buffer: Buffer.from('# 新成功稿') });
  await expect(page.locator('#app-message')).toContainText('已导入');
  await page.evaluate(() => (window as unknown as { expiries: (() => void)[] }).expiries.at(-1)!());
  await expect(page.locator('#app-message')).toBeHidden();
});

test('standalone icon, adaptive A4 width, keyboard help and reduced motion work offline', async ({ page }) => {
  const network: string[] = []; page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
  await page.context().setOffline(true); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(app); await page.locator('#markdown').fill('# 离线图标\n\n正文。');
  const icon = await page.locator('link[rel="icon"]').getAttribute('href'); expect(icon).toMatch(/^data:image\/svg\+xml,/);
  expect(await page.evaluate(async uri => { const image = new Image(); image.src = uri!; await image.decode(); return image.naturalWidth; }, icon)).toBeGreaterThan(0);
  await page.locator('.preview-help summary').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.preview-help p')).toBeVisible();
  for (const width of [1366, 1100, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.locator('#paper').evaluate(e => {
      const v = document.querySelector('#preview-viewport')!, s = getComputedStyle(v);
      return e.getBoundingClientRect().width <= v.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) + 2;
    })).toBe(true);
  }
  expect(await page.locator('#export-word').evaluate(e => getComputedStyle(e).transitionDuration)).toBe('0s');
  expect(network).toEqual([]);
});
