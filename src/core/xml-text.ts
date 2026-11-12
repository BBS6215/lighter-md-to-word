/** XML 1.0 Fifth Edition, production Char. Reject instead of silently deleting text. */
export class XmlTextError extends Error {
  constructor(label: string, code: number, position: number) {
    super(`${label}含有 Word 不支持的字符 U+${code.toString(16).toUpperCase().padStart(4, '0')}（第 ${position} 个字符），请删除该字符后重试。`);
    this.name = 'XmlTextError';
  }
}

export function assertXmlText(value: string, label: string): void {
  let position = 0;
  for (const character of value) {
    position++;
    const code = character.codePointAt(0)!;
    const allowed = code === 0x09 || code === 0x0a || code === 0x0d ||
      (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
    if (!allowed) throw new XmlTextError(label, code, position);
  }
}
