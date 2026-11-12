import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { inlineText, parseDocument, safeFilename, wordFilename } from '../src/core/model';
import { defaultSettings, defaultStore, validateSettings, validateStore } from '../src/core/profiles';
import { renderPreview } from '../src/core/preview';
import { generateWord } from '../src/core/word';

function paragraphs(markdown: string) {
  return parseDocument(markdown).blocks.filter(block => block.kind !== 'table').map(block => inlineText(block.runs));
}
function links(markdown: string) {
  return parseDocument(markdown).blocks.filter(block => block.kind !== 'table').flatMap(block => block.runs.flatMap(run => run.href ? [run.href] : []));
}

describe('1.0.1 Markdown regressions', () => {
  it('collects definitions throughout containers, preserving the first matching definition', () => {
    expect(links('[说明][r]\n\n[r]: https://first.example\n[r]: https://second.example')).toEqual(['https://first.example']);
    expect(links('[说明][r]\n\n> [R]: https://first.example')).toEqual(['https://first.example']);
    expect(links('[说明][r]\n\n- 条目\n\n  [R]: https://first.example')).toEqual(['https://first.example']);
    expect(links('> [R]: https://first.example\n\n[r]: https://second.example\n\n[说明][r]')).toEqual(['https://first.example']);
  });
  it('preserves relative and blocked link destinations as escaped, non-clickable text', async () => {
    const markdown = '[本地资料](docs/report.pdf)\n\n[引用资料][r]\n\n[r]: ftp://files.example/report\n\n[危险](javascript:alert%281%29)';
    const model = parseDocument(markdown), preview = renderPreview(model, defaultSettings());
    expect(paragraphs(markdown).join(' ')).toContain('docs/report.pdf');
    expect(preview).toContain('ftp://files.example/report'); expect(preview).not.toMatch(/href="(?:javascript:|ftp:|docs\/)/);
    const xml = strFromU8(unzipSync(await generateWord(model, defaultSettings()))['word/document.xml']);
    expect(xml).toContain('docs/report.pdf'); expect(xml).toContain('ftp://files.example/report');
  });
  it('resets all counters on a new main title, including numbered children', () => {
    expect(paragraphs('# 第一部分\n\n## 第一节\n\n### 子节\n\n# 第二部分\n\n## 新节\n\n### 子节')).toEqual(['第一部分', '一、第一节', '（一）子节', '第二部分', '一、新节', '（一）子节']);
  });
  it.each(['二〇二五', '二零二五', '二千零二十五'])('continues authored Chinese number %s correctly', number => {
    expect(paragraphs(`## ${number}、计划\n\n## 后续`)).toEqual([`${number}、计划`, '二千零二十六、后续']);
  });
  it('retains 0 for ordered task lists in preview and Word', async () => {
    const model = parseDocument('0. [ ] 首项\n1. [x] 次项');
    expect(renderPreview(model, defaultSettings())).toContain('0. ☐');
    const xml = strFromU8(unzipSync(await generateWord(model, defaultSettings()))['word/document.xml']);
    expect(xml).toContain('0. ☐'); expect(xml).toContain('1. ☑');
  });
  it('treats standalone br tags as blank paragraphs and removes only actual thematic-break nodes', () => {
    const markdown = '前文\n\n<br>\n\n<br />\n\n后文\n\n---\n\n末文\n\n| A | B |\n|---|---|\n| 减号 - | 保留 |';
    const model = parseDocument(markdown), preview = renderPreview(model, defaultSettings());
    expect(paragraphs(markdown)).toEqual(['前文', '', '', '后文', '末文']);
    expect(preview).not.toContain('&lt;br'); expect(preview).not.toContain('<hr'); expect(preview).toContain('减号 -');
    expect(model.warnings.some(warning => warning.includes('分隔线'))).toBe(true);
  });
  it('normalizes an extension-only name before applying the fallback', () => {
    expect(safeFilename('.docx')).toBe('document');
    expect(safeFilename('CON.docx')).toBe('document-CON');
    expect(safeFilename('中文 空格.docx.docx')).toBe('中文 空格');
  });
  it('resolves filename candidates in order, with one extension and a nonempty final stem', () => {
    expect(wordFilename('手动.docx', '标题', '来源')).toBe('手动.docx');
    expect(wordFilename(undefined, '标题', '来源')).toBe('标题.docx');
    expect(wordFilename(undefined, undefined, 'Plain Notes')).toBe('Plain Notes.docx');
    expect(wordFilename('.docx', '.docx', '来源')).toBe('来源.docx');
    expect(wordFilename('.docx', undefined, undefined)).toBe('document.docx');
    expect(wordFilename('.docx. ', undefined, undefined)).toBe('document.docx');
    expect(wordFilename('CON.docx')).toBe('document-CON.docx');
  });
});

describe('XML text validity', () => {
  it.each(['\u0000', '\u0001', '\u000b', '\ufffe', '\uffff', '\ud800', '\udc00'])('rejects forbidden XML text %# before generating a file', value => {
    expect(() => parseDocument(`# 合成材料\n\n前文${value}后文`)).toThrow(/U\+/);
  });
  it('rejects invalid model text or destinations even if a caller bypasses Markdown parsing', async () => {
    for (const field of ['text', 'href'] as const) {
      const model = parseDocument('正文'); const block = model.blocks[0];
      if (block.kind === 'table') throw new Error('Unexpected fixture');
      block.runs[0][field] = '前\u0001后';
      expect(await generateWord(model, defaultSettings()).then(() => false, () => true)).toBe(true);
    }
  });
  it('checks the model title and font metadata while retaining valid Unicode whitespace and emoji', async () => {
    const settings = defaultSettings(); settings.styles.body.font = '字体\ufffe';
    expect(() => validateSettings(settings)).toThrow(/U\+/);
    const model = parseDocument('# 合成材料\n\n中文😀\t正文\r\n下一行');
    const bytes = await generateWord(model, defaultSettings());
    expect(strFromU8(unzipSync(bytes)['word/document.xml'])).toContain('中文😀');
    model.title = '坏\ud800标题';
    expect(await generateWord(model, defaultSettings()).then(() => false, () => true)).toBe(true);
  });
});

describe('direct duplicate profile assertions', () => {
  it('rejects duplicate profile names and IDs independently', () => {
    const store = defaultStore();
    store.profiles.push({ id: 'meeting', name: '会议材料', settings: defaultSettings() });
    expect(() => validateStore({ ...store, profiles: [...store.profiles, { id: 'notes', name: '会议材料', settings: defaultSettings() }] })).toThrow('唯一');
    expect(() => validateStore({ ...store, profiles: [...store.profiles, { id: 'meeting', name: '个人笔记', settings: defaultSettings() }] })).toThrow('唯一');
  });
});
