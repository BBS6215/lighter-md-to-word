@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12 or newer is required for the CLI. The HTML app needs no Node.js. 1>&2
  exit /b 1
)
if not exist "%~dp0cli\md2word.mjs" (
  echo Missing cli\md2word.mjs. Extract the complete repository ZIP, keeping its directory structure. 1>&2
  exit /b 1
)
node "%~dp0cli\md2word.mjs" %*
exit /b %errorlevel%
