import { test, expect, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const app = pathToFileURL(resolve('md2word.html')).href;
const source = '\uFEFF# 同步原型 😀\r\n\r\n' + Array.from({ length: 80 }, (_, i) => `## 第${i}节\r\n\r\n第${i}段\t${'中文 English 😀 '.repeat(i % 7 * 12 + 3)}${i % 9 === 0 ? 'longWord'.repeat(35) : ''}\r\n\r\n${i % 8 === 0 ? '> 引用\r\n>\r\n> - 嵌套列表\r\n\r\n---\r\n\r\n<br><br>\r\n\r\n' : ''}${i % 6 === 0 ? '| 项目 | 内容 |\r\n|---|---|\r\n| 合成行 | 表格内容会换行，继续核对位置。 |\r\n\r\n' : ''}${i % 7 === 0 ? '```text\r\n合成代码\tTab English\r\n第二行 😀\r\n```\r\n\r\n' : ''}`).join('') + '[ref]: ./材料.md\r\n\r\n尾部';
async function ready(page: Page) { await expect(page.locator('#preview-viewport')).toHaveAttribute('data-sync-state', 'ready'); }
async function open(page: Page) {
  await page.setViewportSize({ width: 1366, height: 900 }); await page.goto(app);
  await page.locator('#markdown').fill(source); await ready(page);
}

test('same-paragraph prototype follows native textarea positions in both directions with wrapped mixed text', async ({ page }) => {
  await open(page);
  for (const top of [700, 1800, 4200, 9000]) {
    await page.locator('#markdown').evaluate((e, top) => { e.scrollTop = top; }, top);
    await expect.poll(() => page.evaluate(() => {
      const e = document.querySelector<HTMLTextAreaElement>('#markdown')!, v = document.querySelector('#preview-viewport')!, r = e.getBoundingClientRect();
      const caret = document.caretPositionFromPoint(r.left + parseFloat(getComputedStyle(e).paddingLeft) + 2, r.top + 3);
      if (caret?.offsetNode !== e) return false;
      const blocks = [...document.querySelectorAll<HTMLElement>('#preview-content [data-source-start]')];
      const block = blocks.find(b => +b.dataset.sourceStart! <= caret.offset && +b.dataset.sourceEnd! >= caret.offset) ?? blocks.find(b => +b.dataset.sourceStart! >= caret.offset);
      if (!block) return false;
      const b = block.getBoundingClientRect(), viewport = v.getBoundingClientRect();
      return b.bottom > viewport.top && b.top < viewport.bottom;
    })).toBe(true);
  }
  const selection = await page.locator('#markdown').evaluate(e => [(e as HTMLTextAreaElement).selectionStart, (e as HTMLTextAreaElement).selectionEnd, document.activeElement?.id]);
  for (const block of [page.locator('#preview-content h2').nth(14), page.locator('#preview-content h2').nth(36), page.locator('#preview-content h2').nth(58), page.locator('#preview-content pre').nth(3), page.locator('#preview-content .preview-table').nth(4)]) {
    const offset = await block.evaluate(b => {
      const v = document.querySelector('#preview-viewport')!;
      v.scrollTop += b.getBoundingClientRect().top - v.getBoundingClientRect().top;
      return +b.getAttribute('data-source-start')!;
    });
    await expect.poll(() => page.evaluate(offset => {
      const e = document.querySelector<HTMLTextAreaElement>('#markdown')!, r = e.getBoundingClientRect();
      const caret = document.caretPositionFromPoint(r.left + parseFloat(getComputedStyle(e).paddingLeft) + 2, r.top + 3);
      return caret?.offsetNode === e && Math.abs(caret.offset - offset) < 8;
    }, offset)).toBe(true);
  }
  expect(await page.locator('#markdown').evaluate(e => [(e as HTMLTextAreaElement).selectionStart, (e as HTMLTextAreaElement).selectionEnd, document.activeElement?.id])).toEqual(selection);
  await page.waitForTimeout(250);
  const stable = await page.locator('#markdown').evaluate(e => e.scrollTop);
  await page.waitForTimeout(250); expect(await page.locator('#markdown').evaluate(e => e.scrollTop)).toBe(stable);
});

test('top/bottom, resize, settings rebuild and clear do not leave stale geometry or retained mirrors', async ({ page }) => {
  await open(page);
  await page.locator('#markdown').evaluate(e => { e.scrollTop = e.scrollHeight; });
  await expect.poll(() => page.locator('#preview-viewport').evaluate(e => Math.abs(e.scrollHeight - e.clientHeight - e.scrollTop))).toBeLessThan(2);
  await page.locator('#preview-viewport').evaluate(e => { e.scrollTop = 0; });
  await expect.poll(() => page.locator('#markdown').evaluate(e => e.scrollTop)).toBe(0);
  await page.setViewportSize({ width: 1100, height: 800 }); await ready(page);
  await page.getByRole('button', { name: '格式设置', exact: true }).click();
  await page.getByRole('spinbutton', { name: '正文 字号', exact: true }).fill('14');
  await page.getByRole('spinbutton', { name: '正文 字号', exact: true }).press('Tab');
  await page.getByRole('button', { name: '完成', exact: true }).click(); await ready(page);
  await page.locator('#markdown').fill('新稿'); await page.getByRole('button', { name: '清除', exact: true }).click();
  await expect(page.locator('.source-mirror')).toHaveCount(0);
  await expect(page.locator('#preview-viewport')).toHaveAttribute('data-sync-state', 'idle');
  expect(await page.locator('#preview-viewport').evaluate(e => e.scrollTop)).toBe(0);
});

test('measurement failure suspends sync but Word remains downloadable and next revision recovers', async ({ page }) => {
  await page.goto(app);
  await page.evaluate(() => {
    const original = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = function () { if (this.startContainer.parentElement?.classList.contains('source-mirror')) throw new Error('synthetic'); return original.call(this); };
    (window as unknown as { restoreRange: () => void }).restoreRange = () => { Range.prototype.getBoundingClientRect = original; };
  });
  await page.locator('#markdown').fill('# 测量失败\n\n正文');
  await expect(page.locator('#preview-viewport')).toHaveAttribute('data-sync-state', 'unavailable');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 Word' }).click();
  expect((await download).suggestedFilename()).toBe('测量失败.docx');
  await page.evaluate(() => (window as unknown as { restoreRange: () => void }).restoreRange());
  await page.locator('#markdown').fill('# 新稿\n\n恢复'); await ready(page);
});

test('200 KiB geometry is cached during scrolling and an interrupted build cannot restore the old draft', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 }); await page.goto(app);
  await page.evaluate(() => {
    const original = Range.prototype.getBoundingClientRect;
    (window as unknown as { rangeReads: number }).rangeReads = 0;
    Range.prototype.getBoundingClientRect = function () {
      if (this.startContainer.parentElement?.classList.contains('source-mirror')) (window as unknown as { rangeReads: number }).rangeReads++;
      return original.call(this);
    };
  });
  const long = '# 长文\n\n' + Array.from({ length: 2100 }, (_, i) => `第${i}段 😀 ${'中文 English mixed '.repeat(4)}\n\n`).join('');
  expect(Buffer.byteLength(long)).toBeGreaterThan(200 * 1024);
  await page.locator('#markdown-file').setInputFiles({ name: 'long.md', mimeType: 'text/markdown', buffer: Buffer.from(long) });
  await expect(page.locator('#preview-viewport')).toHaveAttribute('data-sync-state', 'ready', { timeout: 15000 });
  await page.evaluate(() => { (window as unknown as { rangeReads: number }).rangeReads = 0; });
  for (const top of [900, 4000, 15000, 800]) { await page.locator('#markdown').evaluate((e, top) => { e.scrollTop = top; }, top); await page.waitForTimeout(35); }
  expect(await page.evaluate(() => (window as unknown as { rangeReads: number }).rangeReads)).toBe(0);
  await page.evaluate(() => {
    const e = document.querySelector<HTMLTextAreaElement>('#markdown')!;
    e.value += '\n\n旧稿新增'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('compositionend', { bubbles: true }));
    e.value = '# 新稿独立\n\n新段落'; e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await ready(page); await expect(page.locator('#preview-content')).toContainText('新稿独立');
  await expect(page.locator('#preview-content')).not.toContainText('旧稿新增'); await expect(page.locator('.source-mirror')).toHaveCount(0);
});
