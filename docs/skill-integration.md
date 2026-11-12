# 本地 AI / Skill 接入

目标是把“最终 Markdown → 固定中文排版 Word”交给确定性程序。模型负责材料内容；转换器负责已有规则下的排版，不让模型再次生成全文或文档生成代码。

## 可复用的调用规范

1. 先完成内容撰写、修改和必要确认。如果已有最终 MD 文件，直接使用，不为转换重新生成一份。
2. 调用工具安装目录下的 `md2word.cmd convert --input "最终文件路径"`；有明确配置要求时传 `--profile "配置名或ID"`。
3. 使用工具完整路径并为含空格、中文的路径加引号，不依赖 Skill 的工作目录。非 Windows 环境可调用 `node "工具目录/build/cli.js" ...`。
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
