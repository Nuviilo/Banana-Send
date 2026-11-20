@echo off
setlocal EnableDelayedExpansion
title Banana Send - Windows EXE Builder

echo ==================================================
echo   Banana Send - Automatic Windows EXE Builder
echo ==================================================
echo.

where node >nul 2>nul
if !ERRORLEVEL! NEQ 0 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Please install Node.js LTS from https://nodejs.org/ and run this script again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if !ERRORLEVEL! NEQ 0 (
  echo [ERROR] npm is not found in PATH.
  pause
  exit /b 1
)

echo [1/4] Installing app dependencies...
call npm install --no-audit --no-fund
if !ERRORLEVEL! NEQ 0 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

echo.
echo [2/4] Building Windows icon and production web bundle...
if not exist "build\icon.ico" (
  call node scripts\generate-icons.mjs
  if !ERRORLEVEL! NEQ 0 (
    echo [ERROR] Icon generation failed.
    pause
    exit /b 1
  )
)

call npm run build
if !ERRORLEVEL! NEQ 0 (
  echo [ERROR] Vite production build failed.
  pause
  exit /b 1
)

echo.
echo [3/4] Preparing Electron and electron-builder...
if not exist "node_modules\electron\package.json" (
  echo Installing electron and electron-builder...
  call npm install --no-save --no-audit --no-fund electron electron-builder
  if !ERRORLEVEL! NEQ 0 (
    echo [ERROR] Failed to install electron and electron-builder.
    pause
    exit /b 1
  )
) else if not exist "node_modules\electron-builder\package.json" (
  echo Installing electron-builder...
  call npm install --no-save --no-audit --no-fund electron-builder
  if !ERRORLEVEL! NEQ 0 (
    echo [ERROR] Failed to install electron-builder.
    pause
    exit /b 1
  )
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Downloading Electron Windows runtime...
  call node "node_modules\electron\install.js"
  if !ERRORLEVEL! NEQ 0 (
    echo [ERROR] Failed to download Electron runtime binary.
    pause
    exit /b 1
  )
)

echo.
echo [4/4] Packaging Windows EXE installer and portable executable...
set CSC_IDENTITY_AUTO_DISCOVERY=false
call "node_modules\.bin\electron-builder.cmd" --config electron-builder.yml --win
if !ERRORLEVEL! NEQ 0 (
  echo [ERROR] Windows EXE build failed.
  pause
  exit /b 1
)

echo.
echo ==================================================
echo   SUCCESS! Your Windows EXE files are ready in:
echo   %CD%\dist-windows
echo ==================================================
if exist "dist-windows" (
  start "" "dist-windows"
)
pause
