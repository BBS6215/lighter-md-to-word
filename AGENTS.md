# Project conventions

Read README.md and docs/architecture.md before changing behavior. Keep the shared converter and profile schema authoritative for both browser and CLI.

- Preserve the standalone file:// HTML workflow. No conversion service, telemetry, remote assets, or persisted Markdown.
- Never commit personal profiles, real documents, screenshots of real documents, or conversion outputs. Use synthetic fixtures.
- Run pnpm typecheck, pnpm test, pnpm build, and pnpm test:browser for relevant changes. Inspect rendered DOCX pages after layout changes.
- Keep the generated md2word.html consistent with source. Keep README, CLI help, and configuration behavior consistent.
- Do not overwrite unrelated work. Remote changes require explicit user authorization for the current task.
