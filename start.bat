@echo off
rem Double-click this file to start the dashboard on Windows.
rem
rem   start.bat          serve on this computer only
rem   start.bat --lan    also allow other devices on your network
rem
rem The first run installs dependencies and builds the app, which takes a
rem minute. After that it starts in a couple of seconds.

setlocal enabledelayedexpansion
cd /d "%~dp0"

set "PORT=4173"
set "HOSTFLAG="
for %%A in (%*) do (
  if /i "%%A"=="--lan" set "HOSTFLAG=--host"
  if /i "%%A"=="--host" set "HOSTFLAG=--host"
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed.
  echo.
  echo This app is built with Node. Install it once from https://nodejs.org
  echo ^(the LTS download^), then double-click this file again.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%V in ('node -p "process.versions.node.split('.')[0]"') do set "NODEMAJOR=%%V"
if !NODEMAJOR! LSS 20 (
  echo.
  echo Node is too old - Node 20 or newer is needed.
  echo Update it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo First run: installing dependencies ^(once, about 30 seconds^)...
  call npm install --no-audit --no-fund || goto :failed
)

rem Rebuild when any source file is newer than the last build.
set "NEEDSBUILD="
if not exist "dist\index.html" set "NEEDSBUILD=1"
if not defined NEEDSBUILD (
  for /f "delims=" %%F in ('powershell -NoProfile -Command "$b=(Get-Item dist\index.html).LastWriteTime; $n=Get-ChildItem -Recurse -File src, index.html, vite.config.ts, package.json ^| Where-Object { $_.LastWriteTime -gt $b } ^| Select-Object -First 1; if ($n) { 'yes' }" 2^>nul') do set "NEEDSBUILD=1"
)
if defined NEEDSBUILD (
  echo.
  echo Building the app...
  call npm run build || goto :failed
)

echo.
echo Starting Garmin Dashboard on http://localhost:%PORT%
if defined HOSTFLAG echo Other devices on your network can use the second address printed below.
echo Leave this window open while you use the app. Press Ctrl-C to stop.
echo.
start "" "http://localhost:%PORT%"
call npx vite preview --port %PORT% %HOSTFLAG%
goto :eof

:failed
echo.
echo Something went wrong. The messages above should say what.
pause
exit /b 1
