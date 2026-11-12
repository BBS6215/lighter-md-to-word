import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer,
  LevelFormat, LineRuleType, Packer, PageNumber, Paragraph, ShadingType,
  Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType,
  type IParagraphOptions, type IRunOptions,
} from 'docx';
import type { DocumentModel, Inline, ParagraphBlock, TableBlock } from './model';
import type { FormatSettings, StyleKey, TextStyle } from './profiles';
import { STYLE_KEYS, validateSettings } from './profiles';
import { blockStyleKey, contextIndent } from './preview';
import { assertXmlText } from './xml-text';

const cm = (value: number) => Math.round(value * 1440 / 2.54);
const pt = (value: number) => Math.round(value * 20);
const alignment = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
const styleId: Record<StyleKey, string> = { title: 'Title', h1: 'Heading1', h2: 'Heading2', h3: 'Heading3', h4: 'Heading4', body: 'Normal' };
const fonts = (name: string) => ({ ascii: name, hAnsi: name, eastAsia: name, cs: name, hint: 'eastAsia' });

function spacing(settings: FormatSettings) {
  return { line: pt(settings.paragraph.line), lineRule: LineRuleType.EXACT, before: pt(settings.paragraph.before), after: pt(settings.paragraph.after), beforeAutoSpacing: false, afterAutoSpacing: false };
}
function wordRuns(runs: Inline[], style: TextStyle, heading: boolean, code: boolean): (TextRun | ExternalHyperlink)[] {
  return runs.flatMap<TextRun | ExternalHyperlink>(run => {
    assertXmlText(run.text, '正文片段');
    if (run.href !== undefined) assertXmlText(run.href, '链接目标');
    if (run.break) return [new TextRun({ break: 1 })];
    const parts = code ? run.text.split(/\r?\n/u) : [run.text.replace(/\r?\n/gu, ' ')];
    const children = parts.flatMap((text, index) => {
      const options: IRunOptions = {
        text, font: run.code ? 'Courier New' : fonts(style.font), size: Math.round(style.size * 2),
        bold: heading ? style.bold : style.bold || !!run.bold,
        italics: !!run.italic, strike: !!run.strike, color: '000000', snapToGrid: false,
      };
      return [...(index ? [new TextRun({ break: 1 })] : []), new TextRun(options)];
    });
    return run.href ? [new ExternalHyperlink({ link: run.href, children })] : children;
  });
}
function createParagraph(block: ParagraphBlock, settings: FormatSettings): Paragraph {
  const key = blockStyleKey(block), style = settings.styles[key];
  const widthPt = (11906 - cm(settings.margins.left) - cm(settings.margins.right)) / 20;
  const left = pt(contextIndent(block, widthPt));
  const children = wordRuns(block.runs, style, block.kind === 'heading', block.kind === 'code');
  const marker = block.marker;
  if (marker?.kind === 'number' || marker?.kind === 'task') {
    const prefix = marker.kind === 'number' ? `${marker.number}. ` : `${marker.number !== undefined ? `${marker.number}. ` : ''}${marker.checked ? '☑' : '☐'} `;
    children.unshift(...wordRuns([{ text: prefix }], style, false, false));
  }
  const options: IParagraphOptions = {
    children, style: styleId[key],
    alignment: alignment[block.kind === 'code' ? 'left' : style.alignment],
    spacing: spacing(settings),
    indent: { left, ...(marker ? { hanging: pt(12) } : { firstLine: block.depth || block.quote || block.kind === 'code' ? 0 : pt(style.size * style.indentChars) }) },
    keepNext: block.kind === 'heading', keepLines: block.kind === 'heading', widowControl: true,
    ...(marker?.kind === 'bullet' ? { numbering: { reference: 'md-bullets', level: Math.min(marker.depth - 1, 8) } } : {}),
    ...(block.quote ? { border: { left: { style: BorderStyle.SINGLE, color: 'A0A0A0', size: 6, space: 6 } } } : {}),
    ...(block.kind === 'code' ? { shading: { type: ShadingType.CLEAR, fill: 'F4F4F5' } } : {}),
  };
  return new Paragraph(options);
}
function createTable(block: TableBlock, settings: FormatSettings): Table {
  const area = 11906 - cm(settings.margins.left) - cm(settings.margins.right);
  const left = pt(contextIndent(block, area / 20)), width = area - left;
  const columns = Math.max(1, ...block.rows.map(row => row.length));
  const widths = Array.from({ length: columns }, (_, i) => Math.floor(width / columns) + (i < width % columns ? 1 : 0));
  const rows = block.rows.map((row, index) => new TableRow({
    tableHeader: index === 0,
    children: widths.map((cellWidth, column) => new TableCell({
      width: { size: cellWidth, type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      ...(index === 0 ? { shading: { type: ShadingType.CLEAR, fill: 'F0F0F0' } } : {}),
      children: [new Paragraph({
        style: 'Normal', spacing: spacing(settings), indent: { firstLine: 0 },
        alignment: alignment[block.align[column] || 'left'],
        children: wordRuns(row[column] ?? [], { ...settings.styles.body, bold: index === 0 || settings.styles.body.bold }, false, false),
      })],
    })),
  }));
  return new Table({ rows, columnWidths: widths, layout: TableLayoutType.FIXED, width: { size: width, type: WidthType.DXA }, indent: { size: left, type: WidthType.DXA } });
}
function footer(settings: FormatSettings): Footer {
  const options: IRunOptions = { font: fonts(settings.styles.body.font), size: Math.round(settings.pageNumber.size * 2), bold: false, color: '000000' };
  const children = [];
  if (settings.pageNumber.format === 'page') children.push(new TextRun({ ...options, text: '第 ' }));
  if (settings.pageNumber.format === 'dash') children.push(new TextRun({ ...options, text: '- ' }));
  children.push(new TextRun({ ...options, children: [PageNumber.CURRENT] }));
  if (settings.pageNumber.format === 'page') children.push(new TextRun({ ...options, text: ' 页' }));
  if (settings.pageNumber.format === 'dash') children.push(new TextRun({ ...options, text: ' -' }));
  if (settings.pageNumber.format === 'total') children.push(new TextRun({ ...options, text: ' / ' }), new TextRun({ ...options, children: [PageNumber.TOTAL_PAGES] }));
  return new Footer({ children: [new Paragraph({ alignment: alignment[settings.pageNumber.alignment], spacing: { before: 0, after: 0 }, indent: { firstLine: 0 }, children })] });
}
export function createWordDocument(model: DocumentModel, inputSettings: FormatSettings): Document {
  assertXmlText(model.title, '文档标题');
  const settings = validateSettings(inputSettings);
  const paragraphStyles = STYLE_KEYS.map(key => ({
    id: styleId[key], name: key === 'title' ? 'Title' : key === 'body' ? 'Normal' : `Heading ${key.slice(1)}`,
    ...(key === 'body' ? { default: true } : { basedOn: 'Normal', next: 'Normal' }),
    quickFormat: true,
    run: { font: fonts(settings.styles[key].font), size: Math.round(settings.styles[key].size * 2), bold: settings.styles[key].bold, color: '000000', snapToGrid: false },
    paragraph: {
      spacing: spacing(settings), alignment: alignment[settings.styles[key].alignment],
      indent: { firstLine: pt(settings.styles[key].size * settings.styles[key].indentChars) },
      ...(key.startsWith('h') ? { outlineLevel: Number(key.slice(1)) - 1, keepNext: true, keepLines: true } : {}),
    },
  }));
  const children = model.blocks.map(block => block.kind === 'table' ? createTable(block, settings) : createParagraph(block, settings));
  if (!children.length) children.push(new Paragraph({ style: 'Normal', children: [] }));
  return new Document({
    creator: 'md2word-local', title: model.title || 'Document', description: 'Created offline with md2word-local',
    styles: { paragraphStyles },
    numbering: { config: [{ reference: 'md-bullets', levels: Array.from({ length: 9 }, (_, level) => ({
      level, format: LevelFormat.BULLET, text: ['•', '○', '▪'][level % 3], alignment: AlignmentType.LEFT,
      style: { run: { font: settings.styles.body.font, size: Math.round(settings.styles.body.size * 2) }, paragraph: { indent: { left: pt((level + 1) * 18), hanging: pt(12) } } },
    })) }] },
    sections: [{
      properties: { page: {
        size: { width: 11906, height: 16838 },
        margin: { top: cm(settings.margins.top), right: cm(settings.margins.right), bottom: cm(settings.margins.bottom), left: cm(settings.margins.left), header: cm(1), footer: cm(Math.min(1.75, settings.margins.bottom - 0.25)) },
        pageNumbers: { start: 1 },
      } },
      ...(settings.pageNumber.enabled ? { footers: { default: footer(settings) } } : {}),
      children,
    }],
  });
}
export async function generateWord(model: DocumentModel, settings: FormatSettings): Promise<Uint8Array> {
  if (!model.blocks.length) throw new Error('请先输入需要转换的 Markdown 正文');
  return new Uint8Array(await Packer.toArrayBuffer(createWordDocument(model, settings)));
}
