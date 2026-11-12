import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root, RootContent, PhrasingContent, List, Definition } from 'mdast';
import { assertXmlText } from './xml-text';

export interface Inline { text: string; bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; href?: string; break?: boolean }
export interface Marker { kind: 'bullet' | 'number' | 'task'; depth: number; number?: number; checked?: boolean }
export interface Context { depth: number; quote: number; marker?: Marker }
export interface ParagraphBlock extends Context { kind: 'paragraph' | 'heading' | 'code'; runs: Inline[]; level?: number }
export interface TableBlock extends Context { kind: 'table'; rows: Inline[][][]; align: ('left' | 'right' | 'center' | null)[] }
export type Block = ParagraphBlock | TableBlock;
export interface DocumentModel {
  blocks: Block[]; title: string; warnings: string[];
  stats: { sourceCharacters: number; bodyCharacters: number; words: number };
}

const parser = unified().use(remarkParse).use(remarkGfm);
const CHINESE = '零一二三四五六七八九';
export function chineseNumber(value: number): string {
  if (value < 10) return CHINESE[value];
  if (value >= 10000) return String(value);
  let result = '', remainder = value, zero = false;
  for (const [unit, label] of [[1000, '千'], [100, '百'], [10, '十'], [1, '']] as const) {
    const digit = Math.floor(remainder / unit); remainder %= unit;
    if (digit) {
      if (zero) result += '零';
      result += (unit === 10 && digit === 1 && !result ? '' : CHINESE[digit]) + label;
      zero = false;
    } else if (result && remainder) zero = true;
  }
  return result;
}
function readChinese(source: string): number {
  if (/^[零〇一二三四五六七八九两]+$/u.test(source)) {
    return Number(Array.from(source, letter => letter === '两' ? '2' : String(CHINESE.indexOf(letter === '〇' ? '零' : letter))).join(''));
  }
  let result = 0, digit = 0;
  for (const letter of source) {
    const unit = ({ 十: 10, 百: 100, 千: 1000, 万: 10000 } as Record<string, number>)[letter];
    if (unit === 10000) { result = (result + digit) * unit; digit = 0; }
    else if (unit) { result += (digit || 1) * unit; digit = 0; }
    else digit = letter === '两' ? 2 : Math.max(0, CHINESE.indexOf(letter === '〇' ? '零' : letter));
  }
  return result + digit;
}
export function inlineText(runs: Inline[]): string { return runs.map(run => run.break ? '\n' : run.text).join(''); }
export function safeFilename(value: string, fallback = 'document'): string {
  return filenameStem(value) || filenameStem(fallback) || 'document';
}
function filenameStem(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().replace(/[. ]+$/u, '');
  const withoutExtension = cleaned.replace(/(?:\.docx\s*)+$/iu, '').replace(/[. ]+$/u, '').trim();
  let name = Array.from(withoutExtension).slice(0, 80).join('').replace(/[. ]+$/u, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `document-${name}`;
  return name;
}
export function wordFilename(...candidates: (string | undefined)[]): string {
  return (candidates.map(value => filenameStem(value ?? '')).find(Boolean) || 'document') + '.docx';
}
function collectDefinitions(root: Root): Map<string, Definition> {
  const definitions = new Map<string, Definition>();
  const stack: { type: string; children?: unknown[] }[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.type === 'definition') {
      const definition = node as Definition, key = definition.identifier.toLowerCase();
      if (!definitions.has(key)) definitions.set(key, definition);
    }
    const children = node.children ?? [];
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as typeof node);
  }
  return definitions;
}

/** Markdown AST -> deterministic document model. Recursive inline/list handling
 * adapts the MIT word converter in BBS6215/markdown-to-pdf; see THIRD_PARTY_NOTICES. */
export function parseDocument(markdown: string): DocumentModel {
  assertXmlText(markdown, '正文');
  const root = parser.parse(markdown.replace(/^\uFEFF/u, '')) as Root;
  const blocks: Block[] = [], warnings = new Set<string>();
  const definitions = collectDefinitions(root);
  const counters: (number | undefined)[] = [undefined, undefined, undefined, undefined];
  let title = '', titles = 0, removedBreaks = 0;
  const warn = (message: string) => warnings.add(message);
  const safeLink = (url: string): string | undefined => {
    assertXmlText(url, '链接目标');
    if (/^(https?:|mailto:)/i.test(url)) return url;
    warn('相对路径或不支持的链接协议已保留为文字，未生成可点击链接。'); return undefined;
  };
  function inlines(node: PhrasingContent, style: Omit<Inline, 'text'> = {}): Inline[] {
    switch (node.type) {
      case 'text': assertXmlText(node.value, '正文片段'); return [{ text: node.value, ...style }];
      case 'strong': return node.children.flatMap(child => inlines(child, { ...style, bold: true }));
      case 'emphasis': return node.children.flatMap(child => inlines(child, { ...style, italic: true }));
      case 'delete': return node.children.flatMap(child => inlines(child, { ...style, strike: true }));
      case 'inlineCode': return [{ text: node.value, ...style, code: true }];
      case 'break': return [{ text: '', break: true }];
      case 'link': {
        const href = safeLink(node.url), runs = node.children.flatMap(child => inlines(child, { ...style, href }));
        return !href && node.url ? [...runs, { text: ` (${node.url})`, ...style, href: undefined }] : runs;
      }
      case 'linkReference': {
        const def = definitions.get(node.identifier.toLowerCase());
        if (!def) warn('有引用链接未找到定义，已保留链接文字。');
        const href = def ? safeLink(def.url) : undefined;
        const runs = node.children.flatMap(child => inlines(child, { ...style, href }));
        return def && !href && def.url ? [...runs, { text: ` (${def.url})`, ...style, href: undefined }] : runs;
      }
      case 'image': case 'imageReference':
        warn('图片未嵌入，已使用替代文字占位；工具不会加载图片或发送网络请求。');
        return [{ text: `[图片：${node.alt || '未提供说明'}]`, ...style }];
      case 'html':
        if (/^<br\s*\/?>$/i.test(node.value.trim())) return [{ text: '', break: true }];
        warn('原始 HTML 标签未执行，内联标签已忽略；块级 HTML 将作为原文保留。'); return [];
      case 'footnoteReference':
        warn('脚注以标记及正文形式保留，不生成 Word 原生脚注。'); return [{ text: `[注：${node.label || node.identifier}]`, ...style }];
      default: {
        const fallback = node as { value?: string; children?: PhrasingContent[] };
        warn('有不支持的 Markdown 内容，已尽量以文字保留。');
        return fallback.children?.flatMap(child => inlines(child, style)) ?? [{ text: fallback.value ?? '', ...style }];
      }
    }
  }
  function heading(runs: Inline[], level: number): Inline[] {
    const source = inlineText(runs).trim();
    if (level === 0) {
      titles++;
      counters.fill(undefined);
      if (!title) title = source;
      if (titles > 1) warn('存在多个 # 大标题，请确认是否需要合并；工具保留原结构。');
      return runs;
    }
    const patterns = [/^([零〇一二三四五六七八九十百千万两]+)、/, /^[（(]([零〇一二三四五六七八九十百千万两]+)[）)]/, /^(\d+)[.．、]/, /^[（(](\d+)[）)]/];
    const index = level - 1, matched = source.match(patterns[index]);
    if (index > 0 && counters[index - 1] === undefined) warn('存在跳级标题，请检查父级标题是否缺失；工具不会补写章节。');
    if (matched) {
      const value = index < 2 ? readChinese(matched[1]) : Number(matched[1]);
      if (!Number.isSafeInteger(value) || value < 0) { warn('标题编号超出可处理范围，已保留原编号，请核对后续编号。'); return runs; }
      if (counters[index] !== undefined && value !== counters[index]! + 1) warn('已有标题编号不连续或重复，原编号已保留。');
      counters[index] = value;
    } else {
      counters[index] = (counters[index] ?? 0) + 1;
      if (patterns.some(pattern => pattern.test(source))) {
        warn('有标题编号形式与 # 层级不一致，已保留原编号，请核对层级。');
        for (let lower = index + 1; lower < 4; lower++) counters[lower] = undefined;
        return runs;
      }
    }
    for (let lower = index + 1; lower < 4; lower++) counters[lower] = undefined;
    if (matched) return runs;
    const n = counters[index]!;
    const prefix = index === 0 ? `${chineseNumber(n)}、` : index === 1 ? `（${chineseNumber(n)}）` : index === 2 ? `${n}. ` : `（${n}）`;
    return [{ text: prefix }, ...runs];
  }
  function convertList(node: List, context: Context): void {
    if (context.marker) blocks.push({ kind: 'paragraph', runs: [], ...context });
    const depth = context.depth + 1;
    if (depth > 9) warn('列表嵌套超过九级，Word 标记层级已限制为九级。');
    let index = node.start ?? 1;
    for (const item of node.children) {
      const marker: Marker = typeof item.checked === 'boolean' ? { kind: 'task', checked: item.checked, number: node.ordered ? index : undefined, depth } : node.ordered ? { kind: 'number', number: index, depth } : { kind: 'bullet', depth };
      let first = true;
      for (const child of item.children) {
        const previous = blocks.length;
        convert(child, { depth, quote: context.quote, ...(first ? { marker } : {}) });
        if (blocks.length > previous) first = false;
      }
      if (first) blocks.push({ kind: 'paragraph', runs: [], depth, quote: context.quote, marker });
      index++;
    }
  }
  function convert(node: RootContent, context: Context): void {
    switch (node.type) {
      case 'heading': {
        const level = Math.min(node.depth - 1, 4);
        if (node.depth > 5) warn('###### 超过四级标题范围，已按第四级标题排版。');
        blocks.push({ kind: 'heading', level, runs: heading(node.children.flatMap(child => inlines(child)), level), ...context }); break;
      }
      case 'paragraph': blocks.push({ kind: 'paragraph', runs: node.children.flatMap(child => inlines(child)), ...context }); break;
      case 'list': convertList(node, context); break;
      case 'blockquote': {
        let first = true;
        for (const child of node.children) {
          const previous = blocks.length;
          convert(child, { ...context, quote: context.quote + 1, marker: first ? context.marker : undefined });
          if (blocks.length > previous) first = false;
        }
        break;
      }
      case 'table':
        if (context.marker) blocks.push({ kind: 'paragraph', runs: [], ...context });
        blocks.push({ kind: 'table', rows: node.children.map(row => row.children.map(cell => cell.children.flatMap(child => inlines(child)))), align: node.align ?? [], depth: context.depth, quote: context.quote }); break;
      case 'code': blocks.push({ kind: 'code', runs: node.value.split(/\r?\n/u).flatMap((line, i) => [...(i ? [{ text: '', break: true } as Inline] : []), { text: line }]), ...context }); break;
      case 'html':
        if (/^(?:<br\s*\/?>\s*)+$/iu.test(node.value.trim())) {
          const count = node.value.match(/<br\s*\/?>/giu)!.length;
          for (let i = 0; i < count; i++) blocks.push({ kind: 'paragraph', runs: [], ...context, marker: i === 0 ? context.marker : undefined });
          break;
        }
        warn('块级 HTML 未执行，已按原文保留；复杂 HTML 表格暂不转换。');
        blocks.push({ kind: 'code', runs: [{ text: node.value }], ...context }); break;
      case 'footnoteDefinition':
        warn('脚注以标记及正文形式保留，不生成 Word 原生脚注。');
        blocks.push({ kind: 'paragraph', runs: [{ text: `[注：${node.label || node.identifier}]` }], ...context });
        for (const child of node.children) convert(child, context);
        break;
      case 'definition': break;
      case 'thematicBreak': removedBreaks++; break;
      default: warn('有未支持的块级内容，请核对转换提示。');
    }
  }
  for (const node of root.children) convert(node, { depth: 0, quote: 0 });
  if (removedBreaks) warn(`已按材料排版去除 ${removedBreaks} 处分隔线。`);
  if (/(^|[^\\])\$\$[\s\S]*?\$\$|(^|[^\\])\$[^$\n]+\$/u.test(markdown)) warn('公式保留为原始文字，暂不生成 Word 公式对象。');
  const plain = blocks.map(block => block.kind === 'table' ? block.rows.map(row => row.map(inlineText).join(' ')).join('\n') : inlineText(block.runs)).join('\n');
  const words = [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(plain)].filter(segment => segment.isWordLike).length;
  return { blocks, title, warnings: [...warnings], stats: { sourceCharacters: Array.from(markdown).length, bodyCharacters: Array.from(plain.replace(/\s/gu, '')).length, words } };
}
