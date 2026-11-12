import './style.css';
import { defaultSettings, parseStore, selectProfile, serializeStore, STYLE_KEYS, validateStore, type ProfileStore } from '../core/profiles';
import { parseDocument, wordFilename, type DocumentModel } from '../core/model';
import { XmlTextError } from '../core/xml-text';
import { escapeHtml, renderPreview } from '../core/preview';
import { generateWord } from '../core/word';
import { loadPreferences, savePreferences } from './persistence';
import { version } from '../../package.json';

function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const editor = element<HTMLTextAreaElement>('markdown');
const picker = element<HTMLSelectElement>('profile-select');
const filename = element<HTMLInputElement>('filename');
const exportButton = element<HTMLButtonElement>('export-word');
const dialog = element<HTMLDialogElement>('settings-dialog');
const unavailableStorage = { getItem() { throw new Error('Storage unavailable'); }, setItem() { throw new Error('Storage unavailable'); } };
let storage: Storage;
try { storage = window.localStorage; } catch { storage = unavailableStorage as unknown as Storage; }
const loaded = loadPreferences(storage);
let store: ProfileStore = loaded.store, selected = loaded.selected;
let model: DocumentModel | null = parseDocument('');
let manualName: string | undefined, importedStem: string | undefined;
let formInvalid = false, exporting = false, parseError: string | undefined;
let documentRevision = 0, profileImportToken = 0;
let undoSnapshot: { text: string; manualName?: string; importedStem?: string } | null = null;
let undoTimer: ReturnType<typeof setTimeout> | undefined;
let parseTimer: ReturnType<typeof setTimeout> | undefined, readToken = 0;
const styleLabels = { title: '大标题', h1: '一级标题', h2: '二级标题', h3: '三级标题', h4: '四级标题', body: '正文' };
const commonFonts = ['方正小标宋简体', '仿宋_GB2312', '楷体_GB2312', '黑体', '宋体', '仿宋', '楷体', '微软雅黑', 'Times New Roman', 'Arial'];
let fontNames = [...commonFonts];
function current() { return selectProfile(store, selected); }
function message(text: string, error = false): void {
  const box = element('app-message'); box.textContent = text; box.className = `message${error ? ' error' : ''}`; box.hidden = !text;
}
function settingsError(text: string): void {
  const box = element('settings-error'); box.textContent = text; box.hidden = !text;
}
function save(): void {
  element('storage-status').textContent = '配置保存中…';
  const result = savePreferences(storage, store, selected);
  const status = result.saved ? '✓ 配置已保存在此浏览器' : '配置保存失败：本次仍可使用，请导出 JSON 备份';
  element('storage-status').textContent = status;
  element('dialog-save-status').textContent = result.saved ? '配置已保存' : '未保存，请导出备份';
  element('storage-status').classList.toggle('storage-error', !result.saved);
}
function refreshProfiles(): void {
  picker.innerHTML = store.profiles.map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`).join('');
  picker.value = selected;
  element('profile-caption').textContent = current().name;
  const name = element<HTMLInputElement>('profile-name'); name.value = current().name; name.readOnly = selected === 'default';
  element<HTMLButtonElement>('delete-profile').disabled = selected === 'default';
  element<HTMLButtonElement>('create-profile').disabled = store.profiles.length >= 3;
  element('profile-count').textContent = `${store.profiles.length} / 3 套`;
}
function updateExportState(): void {
  exportButton.disabled = !editor.value.trim() || formInvalid || exporting || !!parseError;
  element<HTMLButtonElement>('clear-button').disabled = !editor.value;
}
function paintPreview(): void {
  const settings = current().settings;
  const paper = element('paper'), empty = element('preview-empty');
  paper.hidden = !model || !editor.value.trim(); empty.hidden = !paper.hidden;
  empty.querySelector('h3')!.textContent = parseError ? '当前正文无法预览' : editor.value.trim() ? '正在更新预览…' : '你的文稿，会在这里成形';
  paper.style.padding = `${settings.margins.top}cm ${settings.margins.right}cm ${settings.margins.bottom}cm ${settings.margins.left}cm`;
  const content = element('preview-content');
  content.style.fontFamily = `"${settings.styles.body.font.replace(/[\\"]/g, '\\$&')}", serif`;
  content.style.fontSize = `${settings.styles.body.size}pt`;
  content.style.fontWeight = settings.styles.body.bold ? '700' : '400';
  content.style.lineHeight = `${settings.paragraph.line}pt`;
  content.innerHTML = model ? renderPreview(model, settings) : '';
  element('source-stats').textContent = `原文 ${Array.from(editor.value).length.toLocaleString()} 字符`;
  element('body-stats').textContent = model ? `正文 ${model.stats.bodyCharacters.toLocaleString()} 字符（不含空白）` : '正文尚未解析';
  element('profile-caption').textContent = current().name;
  const warnings = element('conversion-warnings');
  warnings.hidden = !model?.warnings.length;
  warnings.innerHTML = model?.warnings.length ? `<strong>转换提示</strong><ul>${model.warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : '';
  updateExportState();
}
function parseNow(): DocumentModel | null {
  if (parseTimer) clearTimeout(parseTimer);
  parseTimer = undefined;
  try {
    model = parseDocument(editor.value); parseError = undefined; paintPreview();
    if (manualName === undefined) filename.value = editor.value.trim() ? wordFilename(undefined, model.title, importedStem).slice(0, -5) : '';
    return model;
  } catch (error) {
    model = null;
    const detail = error instanceof XmlTextError ? error.message : error instanceof RangeError ? '结构嵌套过深，请简化嵌套后重试。' : '请检查格式后重试。';
    parseError = `正文解析失败：${detail}原文仍保留在输入框。`;
    paintPreview(); message(parseError, true);
    return null;
  }
}
function documentChanged(): void {
  documentRevision++; readToken++; model = null; parseError = undefined;
  message(''); paintPreview();
  if (manualName === undefined) filename.value = importedStem ? wordFilename(importedStem).slice(0, -5) : '';
}
function forgetUndo(): void {
  if (undoTimer) clearTimeout(undoTimer);
  undoSnapshot = null; element('undo-toast').hidden = true;
}
editor.addEventListener('input', () => {
  forgetUndo(); documentChanged();
  if (parseTimer) clearTimeout(parseTimer);
  parseTimer = setTimeout(parseNow, 200);
});
editor.addEventListener('compositionend', parseNow);
editor.addEventListener('paste', event => {
  const text = event.clipboardData?.getData('text/plain');
  // Chromium's native insertText path is very slow for tens of thousands of
  // CJK characters. Keep ordinary editing native, but avoid that path on large pastes.
  if (text && text.length > 32768) {
    event.preventDefault();
    editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, 'end');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
filename.addEventListener('input', () => { manualName = filename.value.trim() || undefined; });
picker.addEventListener('change', () => { profileImportToken++; selected = picker.value; formInvalid = false; settingsError(''); refreshProfiles(); renderSettings(); save(); paintPreview(); });

function numberField(label: string, path: string, value: number, min: number, max: number, step = 0.5): string {
  return `<label class="field"><span>${label}</span><input type="number" data-path="${path}" aria-label="${label}" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
}
function selectField(label: string, path: string, value: string, options: [string, string][]): string {
  return `<label class="field"><span>${label}</span><select data-path="${path}" aria-label="${label}">${options.map(([key, text]) => `<option value="${key}"${key === value ? ' selected' : ''}>${text}</option>`).join('')}</select></label>`;
}
function renderFontList(): void { element('font-options').innerHTML = fontNames.map(name => `<option value="${escapeHtml(name)}"></option>`).join(''); }
function renderSettings(): void {
  const settings = current().settings;
  element('style-fields').innerHTML = `<div class="style-grid style-grid-header" aria-hidden="true"><span>应用范围</span><span>字体名称</span><span>字号 / 磅</span><span>对齐</span><span>缩进 / 字符</span><span>加粗</span></div>` + STYLE_KEYS.map(key => {
    const s = settings.styles[key], label = styleLabels[key];
    return `<div class="style-grid"><strong>${label}</strong><input list="font-options" data-path="styles.${key}.font" aria-label="${label} 字体" value="${escapeHtml(s.font)}" maxlength="120"><input type="number" data-path="styles.${key}.size" aria-label="${label} 字号" min="6" max="72" step="0.5" value="${s.size}"><select data-path="styles.${key}.alignment" aria-label="${label} 对齐">${[['left', '左对齐'], ['center', '居中'], ['right', '右对齐'], ['justify', '两端对齐']].map(([value, name]) => `<option value="${value}"${s.alignment === value ? ' selected' : ''}>${name}</option>`).join('')}</select><input type="number" data-path="styles.${key}.indentChars" aria-label="${label} 首行缩进" min="0" max="8" step="0.5" value="${s.indentChars}"><input type="checkbox" data-path="styles.${key}.bold" aria-label="${label} 加粗"${s.bold ? ' checked' : ''}></div>`;
  }).join('');
  element('paragraph-fields').innerHTML = numberField('固定行距 / 磅', 'paragraph.line', settings.paragraph.line, 8, 120) + numberField('段前 / 磅', 'paragraph.before', settings.paragraph.before, 0, 120) + numberField('段后 / 磅', 'paragraph.after', settings.paragraph.after, 0, 120);
  element('margin-fields').innerHTML = (['top', 'right', 'bottom', 'left'] as const).map((side, i) => numberField(['上边距 / cm', '右边距 / cm', '下边距 / cm', '左边距 / cm'][i], `margins.${side}`, settings.margins[side], 0.5, 5, 0.05)).join('');
  element('page-fields').innerHTML = `<label class="field checkbox-field"><span>显示页码</span><input type="checkbox" data-path="pageNumber.enabled" aria-label="显示页码"${settings.pageNumber.enabled ? ' checked' : ''}></label>` + numberField('页码字号 / 磅', 'pageNumber.size', settings.pageNumber.size, 6, 36) + selectField('页码位置', 'pageNumber.alignment', settings.pageNumber.alignment, [['left', '左侧'], ['center', '居中'], ['right', '右侧']]) + selectField('页码格式', 'pageNumber.format', settings.pageNumber.format, [['number', '1'], ['page', '第 1 页'], ['dash', '- 1 -'], ['total', '1 / 总页数']]);
}
function applyFields(): void {
  profileImportToken++;
  const candidate = structuredClone(store), profile = selectProfile(candidate, selected);
  for (const input of dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-path]')) {
    const parts = input.dataset.path!.split('.');
    let target = profile.settings as unknown as Record<string, unknown>;
    for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>;
    target[parts.at(-1)!] = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input instanceof HTMLInputElement && input.type === 'number' ? (input.value.trim() ? Number(input.value) : NaN) : input.value;
  }
  try {
    store = validateStore(candidate); formInvalid = false; settingsError(''); save(); paintPreview();
  } catch (error) { formInvalid = true; settingsError(error instanceof Error ? error.message : '格式设置有误'); updateExportState(); }
}
dialog.addEventListener('change', event => { if ((event.target as HTMLElement).dataset.path) applyFields(); });
dialog.addEventListener('input', event => {
  const input = event.target as HTMLElement;
  if (input.dataset.path || input.id === 'profile-name' || input.id === 'new-profile-name') profileImportToken++;
});
element('settings-button').addEventListener('click', () => { formInvalid = false; settingsError(''); refreshProfiles(); renderSettings(); updateExportState(); dialog.showModal(); });
dialog.addEventListener('close', () => {
  formInvalid = false; settingsError(''); refreshProfiles(); renderSettings(); updateExportState();
  element('new-profile-row').hidden = true;
});
element('close-settings').addEventListener('click', () => dialog.close());
element('done-settings').addEventListener('click', () => { if (!formInvalid) dialog.close(); });
element<HTMLInputElement>('profile-name').addEventListener('change', event => {
  if (selected === 'default') return;
  const input = event.target as HTMLInputElement, candidate = structuredClone(store);
  selectProfile(candidate, selected).name = input.value;
  try { store = validateStore(candidate); profileImportToken++; refreshProfiles(); save(); if (!formInvalid) settingsError(''); }
  catch (error) { settingsError((error as Error).message); input.value = current().name; }
});
element('create-profile').addEventListener('click', () => {
  profileImportToken++;
  element('new-profile-row').hidden = false; element<HTMLInputElement>('new-profile-name').focus();
});
element('cancel-create').addEventListener('click', () => { element('new-profile-row').hidden = true; });
element('confirm-create').addEventListener('click', () => {
  const name = element<HTMLInputElement>('new-profile-name').value.trim(), candidate = structuredClone(store);
  const id = `profile-${crypto.randomUUID()}`;
  candidate.profiles.push({ id, name, settings: structuredClone(current().settings) });
  try {
    store = validateStore(candidate); profileImportToken++; selected = id; formInvalid = false; settingsError('');
    element('new-profile-row').hidden = true; element<HTMLInputElement>('new-profile-name').value = '';
    refreshProfiles(); renderSettings(); save(); paintPreview();
  } catch (error) { settingsError((error as Error).message); }
});
element('delete-profile').addEventListener('click', () => {
  if (selected === 'default' || !confirm(`删除“${current().name}”配置？其他配置和正文会保留。`)) return;
  profileImportToken++;
  store.profiles = store.profiles.filter(profile => profile.id !== selected); selected = 'default'; formInvalid = false;
  refreshProfiles(); renderSettings(); save(); paintPreview(); settingsError('');
});
element('reset-profile').addEventListener('click', () => {
  profileImportToken++;
  current().settings = defaultSettings(); formInvalid = false; settingsError(''); renderSettings(); save(); paintPreview();
});
function download(bytes: BlobPart, type: string, name: string): void {
  const blob = new Blob([bytes], { type }), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
element('export-profiles').addEventListener('click', () => {
  if (formInvalid) { settingsError('请先修正格式设置，再导出配置。'); return; }
  download(serializeStore(store), 'application/json;charset=utf-8', 'profiles.json');
  message('配置已生成并发起下载。本地 AI 使用前，请用 CLI 导入；正文未写入配置。');
});
element('import-profiles').addEventListener('click', () => element<HTMLInputElement>('profiles-file').click());
element<HTMLInputElement>('profiles-file').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
  if (!file) return;
  const token = ++profileImportToken;
  try {
    if (file.size > 256 * 1024) throw new Error('配置文件过大，请选择本工具导出的 JSON');
    const imported = parseStore(await file.text());
    if (token !== profileImportToken) return;
    store = imported; if (!store.profiles.some(p => p.id === selected)) selected = 'default';
    formInvalid = false; settingsError(''); refreshProfiles(); renderSettings(); save(); paintPreview();
    message(`已导入 ${store.profiles.length} 套配置，正文保持不变。`);
  } catch (error) { if (token === profileImportToken) settingsError((error as Error).message); }
});
element('detect-fonts').addEventListener('click', async () => {
  const api = window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> };
  const status = element('font-status');
  if (!api.queryLocalFonts) { status.textContent = '此浏览器不支持字体检测，可手动填写字体名称，不影响导出。'; return; }
  try {
    const fonts = await api.queryLocalFonts();
    fontNames = [...new Set([...commonFonts, ...fonts.map(font => font.family)])].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    renderFontList(); status.textContent = fonts.length ? `已读取 ${new Set(fonts.map(font => font.family)).size} 个字体家族，可在字体输入框搜索。字体文件不会嵌入 Word。` : '浏览器没有返回字体列表，可手动填写字体名称。';
  } catch { status.textContent = '未取得字体访问权限，可手动填写字体名称，不影响导出。'; }
});
async function importMarkdown(file: File): Promise<void> {
  if (!/\.(md|markdown|txt)$/i.test(file.name)) { message('请选择 .md、.markdown 或 .txt 文件。', true); return; }
  const token = ++readToken;
  try {
    const bytes = await file.arrayBuffer();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (token !== readToken) return;
    forgetUndo(); editor.value = text; manualName = undefined; importedStem = file.name.replace(/\.[^.]+$/, '');
    documentChanged();
    if (parseNow()) message('文件已导入。请核对预览后导出 Word。');
  } catch { if (token === readToken) message('文件读取失败，请确认文件为 UTF-8 编码。原文未被替换。', true); }
}
element('import-markdown').addEventListener('click', () => element<HTMLInputElement>('markdown-file').click());
element<HTMLInputElement>('markdown-file').addEventListener('change', event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''; if (file) void importMarkdown(file);
});
for (const eventName of ['dragover', 'drop']) document.addEventListener(eventName, event => {
  const drag = event as DragEvent;
  if (!drag.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  if (eventName === 'drop') { const file = drag.dataTransfer.files[0]; if (file) void importMarkdown(file); }
});
element('clear-button').addEventListener('click', () => {
  if (!editor.value) return;
  forgetUndo(); undoSnapshot = { text: editor.value, manualName, importedStem };
  editor.value = ''; manualName = undefined; importedStem = undefined; documentChanged();
  parseNow(); editor.focus(); element('undo-toast').hidden = false;
  undoTimer = setTimeout(forgetUndo, 6000);
});
element('undo-button').addEventListener('click', () => {
  if (undoSnapshot === null) return;
  editor.value = undoSnapshot.text; manualName = undoSnapshot.manualName; importedStem = undoSnapshot.importedStem;
  forgetUndo(); documentChanged(); parseNow(); editor.focus();
});
exportButton.addEventListener('click', async () => {
  if (exporting || formInvalid || !editor.value.trim()) return;
  const parsed = parseNow();
  if (!parsed) return;
  // Capture all content and metadata before the first await. Later edits must not
  // rename this download or replace the model/settings that were requested.
  const snapshot = {
    model: parsed, settings: structuredClone(current().settings), revision: documentRevision,
    name: wordFilename(manualName, parsed.title, importedStem),
  };
  exporting = true; updateExportState(); exportButton.textContent = '正在生成…';
  try {
    const bytes = await generateWord(snapshot.model, snapshot.settings);
    download(new Uint8Array(bytes).buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', snapshot.name);
    if (!parseError) message(`${snapshot.name} 已生成并发起下载。${snapshot.revision !== documentRevision ? '页面正文已发生变化，本次下载使用点击导出时的内容。' : '请在下载目录查看；当前正文仍保留在页面。'}`);
  } catch (error) { if (!parseError) message(error instanceof Error ? error.message : '生成失败，请重试。', true); }
  finally { exporting = false; exportButton.innerHTML = '导出 Word <span aria-hidden="true">↗</span>'; updateExportState(); }
});
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !dialog.open) { event.preventDefault(); exportButton.click(); } });
refreshProfiles(); renderFontList(); renderSettings(); paintPreview();
element('version-label').textContent = `v${version}`;
if (loaded.error) { element('storage-status').textContent = loaded.error; element('storage-status').classList.add('storage-error'); }
else element('storage-status').textContent = '配置仅保存在此浏览器，可导出 JSON 备份';

// No Markdown, filenames, or conversion history is ever written to persistent storage.
