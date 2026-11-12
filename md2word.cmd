@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12 or newer is required for the CLI. The HTML app needs no Node.js. 1>&2
  exit /b 1
)
if not exist "%~dp0build\cli.js" (
  echo CLI is not built. Run pnpm install --frozen-lockfile and pnpm build in the project folder. 1>&2
  exit /b 1
)
node "%~dp0build\cli.js" %*
exit /b %errorlevel%
