import type { DocumentModel, Inline, Block, Context } from './model';
import type { FormatSettings, StyleKey } from './profiles';

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
export function blockStyleKey(block: Block): StyleKey {
  return block.kind === 'heading' ? (['title', 'h1', 'h2', 'h3', 'h4'] as const)[block.level ?? 0] : 'body';
}
function cssFont(font: string): string { return `"${font.replace(/[\\"]/g, '\\$&')}"`; }
function inlineHtml(runs: Inline[], heading: boolean): string {
  return runs.map(run => {
    if (run.break) return '<br>';
    let value = escapeHtml(run.text);
    if (run.code) value = `<code>${value}</code>`;
    if (run.bold && !heading) value = `<strong>${value}</strong>`;
    if (run.italic) value = `<em>${value}</em>`;
    if (run.strike) value = `<s>${value}</s>`;
    if (run.href) value = `<a href="${escapeHtml(run.href)}" target="_blank" rel="noopener noreferrer">${value}</a>`;
    return value;
  }).join('');
}
export function contextIndent(context: Context, width: number): number {
  return Math.min(context.depth * 18 + context.quote * 24, Math.max(0, width - 90));
}
export function renderPreview(model: DocumentModel, settings: FormatSettings): string {
  const widthPt = (21 - settings.margins.left - settings.margins.right) * 72 / 2.54;
  return model.blocks.map(block => {
    const key = blockStyleKey(block), style = settings.styles[key];
    const indent = contextIndent(block, widthPt);
    if (block.kind === 'table') {
      return `<div class="preview-table" style="margin-left:${indent}pt"><table>${block.rows.map((row, i) => `<tr>${row.map((cell, column) => {
        const tag = i === 0 ? 'th' : 'td';
        return `<${tag} style="text-align:${block.align[column] || 'left'}">${inlineHtml(cell, false)}</${tag}>`;
      }).join('')}</tr>`).join('')}</table></div>`;
    }
    let marker = '';
    if (block.marker?.kind === 'bullet') marker = '• ';
    if (block.marker?.kind === 'number') marker = `${block.marker.number}. `;
    if (block.marker?.kind === 'task') marker = `${block.marker.number ? `${block.marker.number}. ` : ''}${block.marker.checked ? '☑' : '☐'} `;
    const tag = block.kind === 'heading' ? `h${Math.min((block.level ?? 0) + 1, 6)}` : block.kind === 'code' ? 'pre' : 'p';
    const firstIndent = block.depth || block.quote || block.kind === 'code' ? 0 : style.indentChars;
    const css = `font-family:${cssFont(style.font)},serif;font-size:${style.size}pt;font-weight:${style.bold ? 700 : 400};line-height:${settings.paragraph.line}pt;text-align:${block.kind === 'code' ? 'left' : style.alignment};text-indent:${firstIndent}em;margin:${settings.paragraph.before}pt 0 ${settings.paragraph.after}pt ${indent}pt;`;
    return `<${tag} style="${escapeHtml(css)}">${escapeHtml(marker)}${inlineHtml(block.runs, block.kind === 'heading') || '<br>'}</${tag}>`;
  }).join('');
}
