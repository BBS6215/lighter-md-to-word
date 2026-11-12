export type Alignment = 'left' | 'center' | 'right' | 'justify';
export const STYLE_KEYS = ['title', 'h1', 'h2', 'h3', 'h4', 'body'] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];
export interface TextStyle {
  font: string; size: number; bold: boolean; alignment: Alignment; indentChars: number;
}
export interface FormatSettings {
  styles: Record<StyleKey, TextStyle>;
  paragraph: { line: number; before: number; after: number };
  margins: { top: number; right: number; bottom: number; left: number };
  pageNumber: { enabled: boolean; size: number; alignment: 'left' | 'center' | 'right'; format: 'number' | 'page' | 'dash' | 'total' };
}
export interface Profile { id: string; name: string; settings: FormatSettings }
export interface ProfileStore { schemaVersion: 1; profiles: Profile[] }

export function defaultSettings(): FormatSettings {
  return {
    styles: {
      title: { font: '方正小标宋简体', size: 22, bold: false, alignment: 'center', indentChars: 0 },
      h1: { font: '黑体', size: 16, bold: false, alignment: 'justify', indentChars: 2 },
      h2: { font: '楷体_GB2312', size: 16, bold: true, alignment: 'justify', indentChars: 2 },
      h3: { font: '仿宋_GB2312', size: 16, bold: true, alignment: 'justify', indentChars: 2 },
      h4: { font: '仿宋_GB2312', size: 16, bold: true, alignment: 'justify', indentChars: 2 },
      body: { font: '仿宋_GB2312', size: 16, bold: false, alignment: 'justify', indentChars: 2 },
    },
    paragraph: { line: 28, before: 0, after: 0 },
    margins: { top: 2.54, right: 3.175, bottom: 2.54, left: 3.175 },
    pageNumber: { enabled: true, size: 9, alignment: 'center', format: 'number' },
  };
}
export function defaultStore(): ProfileStore {
  return { schemaVersion: 1, profiles: [{ id: 'default', name: '默认配置', settings: defaultSettings() }] };
}

function object(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key))) throw new Error(`${label}含有不支持的字段`);
  return record;
}
function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label}应为 ${min}–${max} 之间的数字`);
  }
  return value;
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label}不能为空、过长或含控制字符`);
  }
  return value.trim();
}
function choice<T extends string>(value: unknown, label: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw new Error(`${label}的取值不受支持`);
  return value as T;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须是开关值`);
  return value;
}
export function validateSettings(value: unknown): FormatSettings {
  const root = object(value, '排版设置', ['styles', 'paragraph', 'margins', 'pageNumber']);
  const sourceStyles = object(root.styles, '文字样式', STYLE_KEYS);
  const styles = {} as FormatSettings['styles'];
  for (const key of STYLE_KEYS) {
    const style = object(sourceStyles[key], key, ['font', 'size', 'bold', 'alignment', 'indentChars']);
    styles[key] = {
      font: text(style.font, '字体名称', 120), size: number(style.size, '字号', 6, 72),
      bold: boolean(style.bold, '加粗'), alignment: choice(style.alignment, '对齐', ['left', 'center', 'right', 'justify']),
      indentChars: number(style.indentChars, '首行缩进', 0, 8),
    };
  }
  const paragraph = object(root.paragraph, '段落', ['line', 'before', 'after']);
  const margins = object(root.margins, '页边距', ['top', 'right', 'bottom', 'left']);
  const page = object(root.pageNumber, '页码', ['enabled', 'size', 'alignment', 'format']);
  return {
    styles,
    paragraph: { line: number(paragraph.line, '固定行距', 8, 120), before: number(paragraph.before, '段前', 0, 120), after: number(paragraph.after, '段后', 0, 120) },
    margins: { top: number(margins.top, '上边距', 0.5, 5), right: number(margins.right, '右边距', 0.5, 5), bottom: number(margins.bottom, '下边距', 0.5, 5), left: number(margins.left, '左边距', 0.5, 5) },
    pageNumber: { enabled: boolean(page.enabled, '页码开关'), size: number(page.size, '页码字号', 6, 36), alignment: choice(page.alignment, '页码位置', ['left', 'center', 'right']), format: choice(page.format, '页码格式', ['number', 'page', 'dash', 'total']) },
  };
}
export function validateStore(value: unknown): ProfileStore {
  const store = object(value, '配置文件', ['schemaVersion', 'profiles']);
  if (store.schemaVersion !== 1) throw new Error('不支持此配置版本，当前版本为 1');
  if (!Array.isArray(store.profiles) || store.profiles.length < 1 || store.profiles.length > 3) throw new Error('配置数量必须为 1–3 套（含默认配置）');
  const profiles: Profile[] = store.profiles.map((item: unknown) => {
    const p = object(item, '配置', ['id', 'name', 'settings']);
    const id = text(p.id, '配置 ID', 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('配置 ID 只能包含英文字母、数字、短横线和下划线');
    return { id, name: text(p.name, '配置名称', 40), settings: validateSettings(p.settings) };
  });
  if (!profiles.some(p => p.id === 'default')) throw new Error('配置中必须保留 default 默认配置');
  if (new Set(profiles.map(p => p.id)).size !== profiles.length || new Set(profiles.map(p => p.name)).size !== profiles.length) throw new Error('配置 ID 和名称必须分别唯一');
  for (const profile of profiles) {
    if (profiles.some(p => p.id !== profile.id && (p.id === profile.name || p.name === profile.id))) throw new Error('配置名称不能与其他配置 ID 相同');
    if (profile.id === 'default' && profile.name !== '默认配置') throw new Error('default 的名称应为“默认配置”');
  }
  return { schemaVersion: 1, profiles };
}
export function parseStore(source: string): ProfileStore {
  if (new TextEncoder().encode(source).length > 256 * 1024) throw new Error('配置文件过大，请导入本工具导出的 JSON');
  let value: unknown;
  try { value = JSON.parse(source.replace(/^\uFEFF/u, '')); } catch { throw new Error('配置文件不是有效 JSON'); }
  return validateStore(value);
}
export function serializeStore(store: ProfileStore): string { return JSON.stringify(validateStore(store), null, 2) + '\n'; }
export function selectProfile(store: ProfileStore, selector = 'default'): Profile {
  const profile = store.profiles.find(p => p.id === selector || p.name === selector);
  if (!profile) throw new Error(`找不到配置“${selector}”。可用配置：${store.profiles.map(p => `${p.name} (${p.id})`).join('、')}`);
  return profile;
}
