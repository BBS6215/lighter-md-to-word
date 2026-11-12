import { build as viteBuild } from 'vite';
import { build as bundle } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { runtimeLicenses } from './licenses.mjs';

const licenses = await runtimeLicenses(process.cwd());
await viteBuild();
await mkdir('build', { recursive: true });
await bundle({
  entryPoints: ['src/cli/main.ts'], outfile: 'build/cli.js', bundle: true,
  platform: 'node', target: 'node22', format: 'esm', sourcemap: false,
  legalComments: 'eof', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  footer: { js: `/*\n${licenses.replaceAll('*/', '* /')}\n*/` },
});
const html = await readFile('dist/index.html', 'utf8') + `\n<!--\n${licenses.replaceAll('-->', '-- >')}\n-->\n`;
if (/<script\b[^>]*\bsrc\s*=|<link\b[^>]*\brel=["']stylesheet/i.test(html)) {
  throw new Error('Build is not a standalone HTML file');
}
await writeFile('md2word.html', html);
await writeFile('THIRD_PARTY_LICENSES.txt', licenses);
const profilesModule = await bundle({ entryPoints: ['src/core/profiles.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const profilesApi = await import('data:text/javascript;base64,' + Buffer.from(profilesModule.outputFiles[0].text).toString('base64'));
await writeFile('examples/profiles.example.json', profilesApi.serializeStore(profilesApi.defaultStore()));
console.log(`Built standalone md2word.html (${Buffer.byteLength(html).toLocaleString()} bytes) and build/cli.js`);
