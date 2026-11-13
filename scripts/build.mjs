import { build as viteBuild } from 'vite';
import { build as bundle } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { runtimeLicenses } from './licenses.mjs';
import { builtinModules } from 'node:module';
import { zipSync, strToU8 } from 'fflate';

const licenses = await runtimeLicenses(process.cwd());
await viteBuild();
await mkdir('build', { recursive: true });
const cliBuild = await bundle({
  entryPoints: ['src/cli/main.ts'], outfile: 'build/cli.js', bundle: true,
  platform: 'node', target: 'node22', format: 'esm', sourcemap: false, metafile: true,
  legalComments: 'eof', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  footer: { js: `/*\n${licenses.replaceAll('*/', '* /')}\n*/` },
});
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
const imports = cliBuild.metafile.outputs['build/cli.js'].imports;
if (imports.some(item => item.external && !builtins.has(item.path))) throw new Error('Distributed CLI has an external runtime dependency');
await mkdir('cli', { recursive: true });
await writeFile('cli/md2word.mjs', await readFile('build/cli.js'));
const html = await readFile('dist/index.html', 'utf8') + `\n<!--\n${licenses.replaceAll('-->', '-- >')}\n-->\n`;
if (/<script\b[^>]*\bsrc\s*=|<link\b[^>]*\brel=["']stylesheet/i.test(html)) {
  throw new Error('Build is not a standalone HTML file');
}
await writeFile('md2word.html', html);
await writeFile('THIRD_PARTY_LICENSES.txt', licenses);
const profilesModule = await bundle({ entryPoints: ['src/core/profiles.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const profilesApi = await import('data:text/javascript;base64,' + Buffer.from(profilesModule.outputFiles[0].text).toString('base64'));
await writeFile('examples/profiles.example.json', profilesApi.serializeStore(profilesApi.defaultStore()));
// A reproducible, dependency-free distribution. Node.js itself is not bundled.
const archiveFiles = {};
for (const [source, destination] of [
  ['cli/md2word.mjs', 'cli/md2word.mjs'], ['md2word.cmd', 'md2word.cmd'],
  ['cli/README.txt', 'README.txt'], ['LICENSE', 'LICENSE'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'], ['THIRD_PARTY_LICENSES.txt', 'THIRD_PARTY_LICENSES.txt'],
]) {
  let text = (await readFile(source, 'utf8')).replaceAll('\r\n', '\n');
  if (source.endsWith('.cmd')) text = text.replaceAll('\n', '\r\n');
  archiveFiles[destination] = [strToU8(text), { mtime: new Date(1980, 0, 1, 0, 0, 0) }];
}
await mkdir('downloads', { recursive: true });
await writeFile('downloads/lighter-md-to-word-cli.zip', zipSync(archiveFiles, { level: 9 }));
console.log(`Built standalone md2word.html (${Buffer.byteLength(html).toLocaleString()} bytes), cli/md2word.mjs and build/cli.js`);
