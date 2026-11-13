# Lighter · MD to Word：本地 AI / Skill 接入

目标是把“最终 Markdown → 固定中文排版 Word”交给确定性程序。模型负责材料内容；转换器负责已有规则下的排版，不让模型再次生成全文或文档生成代码。

## 可复用的调用规范

1. 先完成内容撰写、修改和必要确认。如果已有最终 MD 文件，直接使用，不为转换重新生成一份。
2. 调用工具安装目录下的 `md2word.cmd convert --input "最终文件路径"`；有明确配置要求时传 `--profile "配置名或ID"`。
3. 使用工具完整路径并为含空格、中文的路径加引号，不依赖 Skill 的工作目录。非 Windows 环境可调用 `node "工具目录/cli/md2word.mjs" ...`。
4. 检查退出码及 JSON 的 `ok`。成功后按 `outputPath` 交付；读取并解释 `warnings`，不能将生成成功等同材料内容或复杂排版全部正确。
5. 按所属业务 Skill 保留必要的内容审查和成品核验。模板套打、批注修订、复杂图文等任务继续使用相应专业流程。
6. 失败时只处理明确错误；不擅自切换配置、覆盖成品、删除输入或隐藏未支持内容。已生成文件需按实际路径核对，不能根据预期文件名猜测。

## 配置选择与更新

- 未指定配置时始终为 `default`，不跟随 HTML 最近选中的配置。
- 使用 `profiles list` 查询 ID、名称、来源和实际配置位置。
- HTML 修改配置后，用户导出 JSON。用 `profiles import --input "导出文件路径"` 导入后，后续转换会读取新配置，无需常驻服务。
- 未导入时可使用内置默认值；明确请求的其他配置不存在则报错，不能用默认配置冒充。
- 不读取 Chrome 内部文件或令牌，不扫描、上传其他材料。只把文件路径交给 CLI，不把正文放进参数或再次发送给模型。

## PowerShell 示例

```powershell
& "D:\Tools\md2word-local\md2word.cmd" profiles list
& "D:\Tools\md2word-local\md2word.cmd" convert --input "D:\Documents\final.md" --profile default
```

以上路径是通用示例，请使用真实安装路径。开发环境要求和完整命令见 README。本仓库提供接入规范，不自动修改全局配置或既有 Skill，也不要求安装 MCP。

## 可选快捷 Skill

把接入约定包装为一个名为 `md2word` 的薄 Skill，保留自动发现，不扩大到写作或现有 Word 编辑。安装后可说“用 md2word 把这份最终稿导出 Word”；Codex 显式使用 `$md2word`，Claude Code 使用 `/md2word`。新入口未出现时，在新会话检查加载结果。

创建 `md2word/SKILL.md`，核心说明可以采用下面的通用模板，并将程序位置替换为真实安装目录：

```markdown
---
name: md2word
description: 将已有最终 Markdown 通过本机 md2word-local 导出固定格式 Word；不承担材料撰写、Word 编辑或复杂模板处理。
---

使用当前会话明确的最终 MD；不为转换重新生成或发送正文。文件有歧义时询问。
调用实际安装目录下的 CLI，路径作为独立参数并正确引用：
node "工具目录/cli/md2word.mjs" convert --input "最终稿绝对路径"
未指定时固定使用 default；明确指定其他配置时追加 --profile。
检查退出码、结果 JSON 的 ok 以及 outputPath 文件确实存在，再返回实际链接和必要 warnings。
失败时说明错误，不静默改配置、不重写源 MD、不覆盖已有 Word。
```

个人入口分别位于 Codex 的用户 `.agents/skills/` 和 Claude 的 `.claude/skills/` 下。使用统一 Skill 管理的机器，应遵循其正式源文件、链接入口和登记规则，避免两份可编辑源码。该模板是通用接入示例，仓库不包含个人安装路径、排版配置或认证信息。

验证应区分：文件/元数据校验、宿主能否发现 Skill、真实 CLI 成品结果，以及模型是否会在自然语言下正确选用。列出 Skill 不等于已完成模型行为评测；转换本身不调用大模型，Skill 加载与工具调用仍有上下文开销。
