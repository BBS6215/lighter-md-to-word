# MD → Word · 离线排版工具

把 AI 生成的 Markdown 最终稿，转换为符合固定格式、可以继续编辑的 Word。**普通使用者只需要一个 HTML 文件。**

当前版本：**1.0.1**。修复解析失败误导出旧稿、异步文件名错配、配置导入竞态及链接/编号等问题；既有合法配置仍使用 `schemaVersion: 1`，无需重建。

- **网页 AI 内容**：复制、粘贴，或导入 `.md/.markdown/.txt`，选配置后导出 `.docx`。
- **本地 AI / Skill**：最终 MD 落盘后，只传文件路径给 CLI；转换器不调用大模型，也不要求模型再次发送整篇正文。
- **最多三套配置**：一套默认、两套自定义，可调整字体、字号、段落、页边距和页码。
- **离线、无账号**：无转换服务器、无上传、无统计上报、无正文历史；首版不需要 MCP。

## 直接使用：无需安装

1. [下载仓库 ZIP](https://github.com/BBS6215/md2word-local/archive/refs/heads/main.zip)，解压。
2. 双击根目录的 **`md2word.html`**，推荐桌面版 Chrome 或 Edge。
3. 粘贴或导入最终稿，核对预览，点击“导出 Word”。也支持 `Ctrl+Enter`。

分享给同事时，只发送 `md2word.html` 即可；他们不需要 Node.js、Git 或其他依赖。也可以打开 [HTML 文件](./md2word.html)，使用 GitHub 的“Download raw file”下载，不能把 GitHub 文件查看页面直接当作工具运行。

正文在导出后仍保留在页面；清除、替换或关闭后不由工具留存，刷新后清空。清除后 6 秒内可撤销；输入新内容后旧稿撤销失效。

生成期间可以继续编辑；每次下载固定使用点击导出时的正文、配置和文件名。解析失败会清除旧预览并阻止导出，原文保留供修改。文件名按“手动名称 → 大标题 → 导入文件主名 → document”选择有效值，统一处理扩展名和 Windows 保留名称。

## 默认排版

| 项目 | 默认值 |
|---|---|
| 页面 | A4；上下边距 2.54 cm，左右 3.175 cm |
| 大标题 | 方正小标宋简体，二号 22 磅，居中，不加粗、不缩进 |
| 一级标题 | 黑体，三号 16 磅，不额外加粗 |
| 二级标题 | 楷体_GB2312，三号，加粗 |
| 三级、四级标题 | 仿宋_GB2312，三号，均加粗 |
| 正文 | 仿宋_GB2312，三号，两端对齐 |
| 段落 | 大标题、一级至四级标题及正文固定行距 28 磅，段前段后 0 |
| 缩进 | 正文、一级至四级标题首行缩进 2 字符 |
| 页码 | 居中阿拉伯数字，从 1 开始，9 磅 |

Markdown 层级对应：

```markdown
# 文档大标题
## 一级标题       → 一、
### 二级标题      → （一）
#### 三级标题     → 1.
##### 四级标题    → （1）
```

缺少编号时补齐；已有编号保留并参与计数，上级变化时下级重新计数。遇到跳级、重复或不连续时提示核对，不擅自重写原文。标题加粗以配置为准，正文中的 Markdown 强调会保留。

## 三套配置如何保存

打开“格式设置”即可修改当前配置。默认配置可调整、恢复出厂格式，不可删除；另外两套按需创建，可命名、复制、修改和删除。初次打开只有默认配置。

合法设置自动**尝试**保存在浏览器，并显示结果；保存失败时，本次仍能导出 Word 和配置 JSON。`file://` 存储由浏览器管理，清理浏览器数据、移动 HTML 或换浏览器后可能无法恢复，建议导出 JSON 备份。

“导入配置”会替换当前配置集合，正文保持不变；无效 JSON、超过三套、缺少默认配置或重名会拒绝导入。配置只包含排版参数，不含正文、输入文件名或转换历史。

连续选择多个配置文件时，只采纳最后一次选择；等待期间手动修改配置会使旧读取失效。关闭设置或按 Escape 会放弃无效字段草稿，已合法生效的设置继续保留。

### 把网页设置交给本地 AI

1. 在 HTML 中调整好配置。
2. 点击“导出 AI 配置（JSON）”。
3. 用下面的 `profiles import` 命令导入下载文件。
4. 以后配置没变就不用重复操作；只在改格式后重新导出、导入。

页面记住上次选择，**AI 不指定时固定使用 `default`**。导出 JSON 只是下载文件，不代表 CLI 已自动同步。

## CLI：供本地 AI 和 Skill 调用

这部分需要 Node.js **22.12 或更新版本**，开发依赖使用锁定的 pnpm；HTML 用户不需要这些软件。

### 首次安装与构建

```powershell
git clone https://github.com/BBS6215/md2word-local.git
cd md2word-local
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

如果本机已有 `pnpm`，可以直接使用 `pnpm install --frozen-lockfile` 和 `pnpm build`。不用全局安装本项目，也不需要启动网页。

### 转换文件

```powershell
# 默认：输入文件旁生成 Word；使用 default 配置
.\md2word.cmd convert --input "D:\Documents\最终 稿.md"

# 指定输出路径和一套已导入的配置
.\md2word.cmd convert --input "D:\Documents\最终 稿.md" --output "D:\Documents\交付稿.docx" --profile "会议材料"

# 导入 HTML 导出的全部配置
.\md2word.cmd profiles import --input "D:\Downloads\profiles.json"

# 查看配置名称、ID、来源和实际配置位置
.\md2word.cmd profiles list
```

从其他目录或 Skill 中调用时，使用 `md2word.cmd` 的完整路径并正确加引号；Unix 系统或不使用 Windows 包装器时可以调用 `node "/path/to/md2word-local/build/cli.js" ...`。

完整接口：

```text
convert --input <final.md> [--output <document.docx>]
        [--profile <id-or-name>] [--config <profiles.json>]
profiles list [--config <profiles.json>]
profiles import --input <exported-profiles.json> [--config <destination.json>]
```

- 输入必须是 UTF-8 的 `.md/.markdown/.txt`，原文件不删除、不改写。
- 默认个人配置为**工具目录下** `.local/profiles.json`，与调用时所在目录无关；`--config` 可指定其他配置文件。
- 尚未导入时使用内置默认配置并给出提示；损坏配置、明确指定但不存在的配置文件、未知配置名会失败，不静默换用其他配置。
- 每次调用重新读取配置，开始后固定本次快照；页面最近选择不影响 CLI 默认值。
- 已有同名 Word 不覆盖，自动生成 `名称 (2).docx` 等。
- 配置导入先校验，再写同目录临时文件、刷新关闭、替换并回读核验；失败不会先删除旧配置。
- 成功向 stdout 返回一行 JSON；失败向 stderr 返回错误 JSON 并以非零状态退出。结果包含输出路径、配置和提示，不包含正文。

**不需要打开 HTML，也不需要常驻服务。**转换程序不消耗模型 API Token；Skill 的命令调用、材料写作和必要审查仍有各自的成本，不承诺固定节省比例。

Skill 调用约定见 [AI 与 Skill 接入说明](./docs/skill-integration.md)。本项目不会自动安装或修改已有 Skill。

## 支持范围与效果边界

支持标题、段落、强调、超链接、嵌套列表、任务标记、基础管道表格和代码。所有输入都会进行完整转换，不会因为预览长度而截断导出。

相对地址及不支持协议的链接保留“文字＋地址”，不生成可点击链接。引用定义全文有效，同名定义采用第一个。独立 `<br>` 生成空行；Markdown 分隔线按材料排版去掉，并给出转换说明，表格和普通减号保留。

非法控制字符会导致 Word 文件无法正常解析，因此检测到这类字符时阻止生成并指出字符编码和位置，不静默删除正文。合法中文、换行和 emoji 不受影响。

图片以替代文字占位，不读取本地或远程图片；公式保留原始文字；复杂 HTML 和脚注等未支持的排版会提示，并尽量保留可核对的文字。请按提示检查，复杂文档仍应使用专门的排版流程。

本地字体检测需要支持的浏览器和授权，拒绝或返回空列表不影响手动填写和导出。字体文件不会嵌入文档，其他电脑缺字体时可能发生替换。

浏览器预览为近似样式，不能保证与 Word/WPS 的分页一致，最终以实际打开和渲染结果为准。字符数是正文 Unicode 字符统计，不等同 Word 的“字数”。

## 开发与验证

```powershell
pnpm typecheck
pnpm build
pnpm test
pnpm test:browser
```

也可直接运行 `pnpm check`。核心测试包含真实 CLI 集成，因此应先构建再运行 `pnpm test`；CI 使用相同顺序。

浏览器测试在本机默认使用已安装的 Chrome；CI 使用 Playwright Chromium。没有 Chrome 时可设置 `CI=1`，并先运行 `pnpm exec playwright install chromium`。测试使用合成内容，输出位于被 Git 排除的 `test-results/`。

构建生成浏览器成品 `md2word.html` 及 CLI `build/cli.js`。HTML 随源码提交供直接下载，CLI 可由锁文件重新构建。发布前应检查生成的 DOCX，不能只凭测试退出码判断排版正确。

架构说明见 [docs/architecture.md](./docs/architecture.md)，本次验证环境和结果见 [docs/validation.md](./docs/validation.md)。

## 许可证

[MIT](./LICENSE)。部分递归转换思路适配自同一作者的 `markdown-to-pdf`；第三方依赖和许可说明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。个人配置、真实材料、输入正文、字体和转换成品不应提交到公开仓库。
