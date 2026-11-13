import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { parseDocument } from '../src/core/model';
import { renderPreview } from '../src/core/preview';
import { generateWord } from '../src/core/word';
import { defaultSettings } from '../src/core/profiles';

describe('source geometry metadata', () => {
  for (const newline of ['\n', '\r\n', '\r']) it(`uses original UTF-16 offsets with BOM, emoji and ${JSON.stringify(newline)}`, () => {
    const input = ['\uFEFF# 标题 😀', '', '前文 😀 emoji', '', '## 后续标题', '', '> 引用', '', '- 列表'].join(newline);
    const model = parseDocument(input);
    expect(model.blocks[0].source?.start).toBe(1);
    const next = model.blocks.find(block => block.kind === 'heading' && block.level === 1)!;
    expect(next.source?.start).toBe(input.indexOf('## 后续标题'));
    for (const block of model.blocks) {
      expect(block.source).toBeDefined();
      expect(input.slice(block.source!.start, block.source!.end)).not.toBe('');
    }
  });
  it('maps nested leaves and repeated br blocks without assigning phantom sources to synthetic markers', () => {
    const input = '- > 嵌套引用\n\n  - 子项\n\n<br><br>\n\n---\n\n[ref]: ./材料.md\n\n[链接][ref]';
    const model = parseDocument(input);
    expect(model.blocks.filter(block => block.source).map(block => input.slice(block.source!.start, block.source!.end))).toEqual(['嵌套引用', '子项', '<br><br>', '[链接][ref]']);
    const html = renderPreview(model, defaultSettings());
    expect(html).toContain(`data-source-start="${input.indexOf('子项')}"`);
    expect(html).not.toContain('data-source-start="-');
  });
  it('metadata does not change document, style or footer XML', async () => {
    const model = parseDocument('# 合成稿\n\n## 章节\n\n- 列表\n\n|列|值|\n|-|-|\n|甲|乙|\n\n<br><br>\n\n正文😀');
    const without = structuredClone(model); for (const block of without.blocks) delete block.source;
    const a = unzipSync(await generateWord(model, defaultSettings())), b = unzipSync(await generateWord(without, defaultSettings()));
    const normalize = (bytes: Uint8Array) => strFromU8(bytes).replace(/r:id="[^"]*"/g, 'r:id="ID"').replace(/w:numId w:val="\d+"/g, 'w:numId w:val="ID"');
    for (const name of ['word/document.xml', 'word/styles.xml', 'word/footer1.xml']) expect(normalize(a[name])).toBe(normalize(b[name]));
  });
});
