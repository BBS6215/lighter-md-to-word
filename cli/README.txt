Lighter · MD to Word — Prebuilt CLI / 预打包命令行工具

中文：需要 Node.js 22.12+。完整解压并保留 cli/ 目录结构；无需 npm install 或 pnpm build。
English: Requires Node.js 22.12+. Extract with the cli/ directory intact. No npm install or build step.

Windows PowerShell:
  .\md2word.cmd --version
  .\md2word.cmd convert --input "D:\Documents\final.md"

Direct Node / 本地 AI 从任意目录调用：
  node "D:/Tools/Lighter/cli/md2word.mjs" convert --input "D:/Documents/final.md"

Profiles / 配置：
  .\md2word.cmd profiles list
  .\md2word.cmd profiles import --input "D:\Downloads\profiles.json"

默认使用 default，不跟随 HTML 最近选择。已有 Word 不覆盖。源 MD 不改写。
Default profile: default. It does not follow the browser selection. Existing Word files are never overwritten; source MD is unchanged.

AI：使用用户明确的最终稿路径，检查退出码、JSON ok 和实际 outputPath，再返回文件链接及必要 warnings。不要重新发送整篇正文或静默切换配置。
AI: use the specified final MD path; verify the exit code, JSON ok, and actual outputPath, then return the real file link and relevant warnings. Do not resend the document or silently change profiles.

配置保存在工具根目录 .local/profiles.json，与调用时所在目录无关。首次未导入时使用内置默认值并提示。
Profiles live at the tool root .local/profiles.json, independent of the working directory. A first run without imported profiles uses built-in defaults with a warning.

转换器不调用模型 API；AI Skill 和工具调用仍有上下文开销。
The converter makes no model API calls. AI Skill loading and tool calls have their own context costs.

完整帮助 / Help: node ./cli/md2word.mjs --help
中文 / English docs: https://github.com/BBS6215/lighter-md-to-word
