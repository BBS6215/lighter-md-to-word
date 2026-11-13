import { createRequire } from 'node:module';
import { dirname, join, parse } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';

export async function runtimeLicenses(root) {
  const found = new Map();
  async function visit(name, from) {
    const resolver = createRequire(join(from, 'package.json'));
    let entry;
    try { entry = resolver.resolve(`${name}/package.json`); } catch { entry = resolver.resolve(name); }
    let folder = dirname(entry), meta;
    while (folder !== parse(folder).root) {
      try { const value = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8')); if (value.name === name) { meta = value; break; } } catch {}
      folder = dirname(folder);
    }
    if (!meta) throw new Error(`Cannot locate license for ${name}`);
    const key = `${meta.name}@${meta.version}`;
    if (found.has(key)) return;
    const files = (await readdir(folder, { withFileTypes: true })).filter(file => file.isFile() && /^(licen[cs]e|copying|notice)([.\-]|$)/i.test(file.name)).map(file => file.name).sort();
    const texts = await Promise.all(files.map(file => readFile(join(folder, file), 'utf8')));
    if (!texts.length) {
      const readme = (await readdir(folder)).find(file => /^readme(\.md|\.markdown|\.txt)?$/i.test(file));
      const source = readme ? await readFile(join(folder, readme), 'utf8') : '';
      const start = source.search(/^#{1,6}\s*(?:license|copyright)\b/im);
      if (start < 0) throw new Error(`Missing license text for ${key}`);
      texts.push(source.slice(start));
    }
    found.set(key, `${key} (${meta.license || 'see license below'})\n${texts.join('\n')}`.trim());
    for (const dependency of Object.keys(meta.dependencies || {}).sort()) await visit(dependency, folder);
  }
  const project = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  for (const name of Object.keys(project.dependencies).sort()) await visit(name, root);
  return 'Runtime dependency license notices for Lighter - MD to Word\n\n' + [...found.keys()].sort().map(key => found.get(key)).join('\n\n' + '='.repeat(72) + '\n\n') + '\n';
}
