# Third-party notices

This project is distributed under the MIT License. Copyright (c) 2026 BBS6215.

Recursive inline formatting, list-context handling, and table width handling were adapted from the MIT-licensed converter in [BBS6215/markdown-to-pdf](https://github.com/BBS6215/markdown-to-pdf), baseline commit `40007a0`. Its copyright and permission notice are retained in LICENSE. No account, backend, SEO, or production configuration from that project is included.

Runtime dependencies:

| Package | License | Source |
|---|---|---|
| docx | MIT | https://github.com/dolanmiu/docx |
| unified | MIT | https://github.com/unifiedjs/unified |
| remark-parse | MIT | https://github.com/remarkjs/remark |
| remark-gfm | MIT | https://github.com/remarkjs/remark-gfm |

Full runtime dependency license text, including transitive dependencies, is generated as [THIRD_PARTY_LICENSES.txt](./THIRD_PARTY_LICENSES.txt) and embedded in the standalone HTML and CLI. This keeps the notices with the HTML when it is shared alone. Build and test tooling includes Vite, vite-plugin-singlefile, TypeScript, esbuild, Vitest, Playwright, and fflate under their respective licenses; see pnpm-lock.yaml for the exact dependency graph. Font files are not redistributed.
