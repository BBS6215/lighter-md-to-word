import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { defaultSettings, defaultStore, parseStore, selectProfile, serializeStore, validateStore } from '../src/core/profiles';
import { chineseNumber, inlineText, parseDocument, safeFilename } from '../src/core/model';
import { renderPreview } from '../src/core/preview';
import { generateWord } from '../src/core/word';
import { loadPreferences, savePreferences, PROFILE_KEY } from '../src/browser/persistence';

describe('profiles and browser preferences', () => {
  it('retains at most three named profiles and always resolves default independently of page selection', () => {
    const store = defaultStore();
    store.profiles.push({ id: 'meeting', name: '会议材料', settings: { ...defaultSettings(), paragraph: { line: 30, before: 0, after: 0 } } });
    store.profiles.push({ id: 'notes', name: '个人笔记', settings: defaultSettings() });
    expect(parseStore(serializeStore(store))).toEqual(store);
    expect(selectProfile(store).id).toBe('default'); expect(selectProfile(store, '会议材料').id).toBe('meeting');
    expect(() => validateStore({ ...store, profiles: [...store.profiles, { ...store.profiles[1], id: 'four', name: '第四套' }] })).toThrow('1–3');
    expect(() => validateStore({ ...store, profiles: store.profiles.slice(1) })).toThrow('default');
    expect(() => selectProfile(store, 'missing')).toThrow('可用配置');
  });
  it('rejects ambiguous or malformed configuration without accepting hidden content fields', () => {
    const store = defaultStore();
    expect(() => parseStore('invalid json')).toThrow('JSON');
    expect(() => validateStore({ ...store, markdown: 'private body' })).toThrow('不支持的字段');
    expect(() => validateStore({ ...store, schemaVersion: 2 })).toThrow('版本');
    store.profiles[0].settings.styles.body.size = NaN;
    expect(() => validateStore(store)).toThrow('字号');
  });
  it('stores profiles and selection only, reports disabled storage, and recovers invalid stored data', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    expect(savePreferences(storage, defaultStore(), 'default').saved).toBe(true);
    expect(loadPreferences(storage).store).toEqual(defaultStore());
    expect([...data.keys()]).toHaveLength(2);
    data.set(PROFILE_KEY, '{broken'); expect(loadPreferences(storage).error).toBeTruthy();
    const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    expect(savePreferences(blocked, defaultStore(), 'default').saved).toBe(false);
  });
});

describe('shared Markdown model', () => {
  it('continues authored numbering, resets children, and leaves authored discontinuities visible', () => {
    const model = parseDocument('# 标题\n\n## 二、已有编号\n\n### 子项\n\n#### 细项\n\n##### 说明\n\n## 后续\n\n### 子项\n\n## 五、跳号');
    const text = model.blocks.filter(block => block.kind !== 'table').map(block => inlineText(block.runs));
    expect(text).toEqual(['标题', '二、已有编号', '（一）子项', '1. 细项', '（1）说明', '三、后续', '（一）子项', '五、跳号']);
    expect(model.warnings.some(warning => warning.includes('不连续'))).toBe(true);
    expect([9, 10, 11, 20, 101, 1001].map(chineseNumber)).toEqual(['九', '十', '十一', '二十', '一百零一', '一千零一']);
  });
  it('escapes HTML and unsafe links, keeps image placeholders and warns on unsupported content', () => {
    const model = parseDocument('# <img src=x onerror=alert(1)>\n\n![示意图](https://example.invalid/private.png)\n\n[危险](javascript:alert(1))\n\n$$x^2$$\n\n<table><tr><td>内容</td></tr></table>');
    const preview = renderPreview(model, defaultSettings());
    expect(preview).not.toMatch(/<img|<script|href="javascript:/);
    expect(preview).toContain('[图片：示意图]'); expect(preview).toContain('&lt;table&gt;');
    expect(model.warnings.length).toBeGreaterThanOrEqual(3);
  });
  it('preserves nested list markers once per item and all table text', () => {
    const model = parseDocument('- 第一段\n\n  后续段\n  - 子项\n\n| A | B |\n|---|---|\n| 中文 | **加粗** |');
    expect(model.blocks.filter(block => block.marker)).toHaveLength(2);
    expect(model.blocks.some(block => block.kind === 'table' && inlineText(block.rows[1][1]) === '加粗')).toBe(true);
  });
  it('retains the tail of long documents and produces safe Chinese filenames', () => {
    const markdown = '# 长文\n\n' + '这是一段用于验证长文完整性的合成内容。\n\n'.repeat(5000) + '最终尾标记';
    const model = parseDocument(markdown);
    expect(Buffer.byteLength(markdown)).toBeGreaterThan(200 * 1024);
    expect(renderPreview(model, defaultSettings())).toContain('最终尾标记');
    expect(safeFilename('中文材料 / 说明:*')).toBe('中文材料 说明'); expect(safeFilename('CON')).toBe('document-CON');
  });
});

describe('real DOCX output', () => {
  it('writes explicit CJK fonts, exact spacing, semantic headings, page fields and fitting table widths', async () => {
    const model = parseDocument('# **合成标题**\n\n## 一级标题\n\n正文 **加粗**。\n\n| 项目 | 结果 |\n|---|---|\n| 示例 | 合格 |');
    const zip = unzipSync(await generateWord(model, defaultSettings()));
    const doc = strFromU8(zip['word/document.xml']), styles = strFromU8(zip['word/styles.xml']), footer = strFromU8(zip['word/footer1.xml']);
    expect(doc).toContain('w:line="560"'); expect(doc).toContain('w:lineRule="exact"');
    expect(doc).toContain('w:eastAsia="仿宋_GB2312"'); expect(doc).toContain('w:sz w:val="32"');
    expect(doc).toContain('w:firstLine="640"'); expect(doc).toContain('w:top="1440"'); expect(doc).toContain('w:left="1800"');
    expect(styles).toContain('w:outlineLvl w:val="0"'); expect(footer).toContain('PAGE'); expect(footer).toContain('w:sz w:val="18"');
    expect(doc).toContain('w:gridCol w:w="4153"'); expect(doc).toContain('w:tcW w:type="dxa" w:w="4153"');
    for (const paragraph of doc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
      expect((paragraph.match(/<w:pStyle\b/g) ?? []).length).toBeLessThanOrEqual(1);
    }
    const titleRun = doc.slice(doc.indexOf('方正小标宋简体'), doc.indexOf('合成标题'));
    expect(titleRun).toContain('w:b w:val="false"');
  });
  it('supports page numbering off and custom settings without altering the model', async () => {
    const model = parseDocument('# 测试\n\n正文'), settings = defaultSettings();
    settings.pageNumber.enabled = false; settings.styles.body.size = 14; settings.paragraph.line = 30;
    const zip = unzipSync(await generateWord(model, settings));
    expect(zip['word/footer1.xml']).toBeUndefined();
    expect(strFromU8(zip['word/document.xml'])).toContain('w:line="600"');
    expect(model.title).toBe('测试');
  });
});
