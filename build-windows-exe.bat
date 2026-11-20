@echo off
setlocal EnableDelayedExpansion
title Banana Send - Windows EXE Builder

echo ==================================================
echo   Banana Send - Automatic Windows EXE Builder
echo ==================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Please install Node.js LTS from https://nodejs.org/ and run this script again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] npm is not found in PATH.
  pause
  exit /b 1
)

echo [1/4] Installing app dependencies (clean mode)...
call npm install --no-audit --no-fund
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

echo.
echo [2/4] Ensuring Windows icon and web production bundle...
if not exist "build\icon.ico" (
  call node scripts/generate-icons.mjs
)
call npm run build
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Vite production build failed.
  pause
  exit /b 1
)

echo.
echo [3/4] Checking Electron & electron-builder tools...
if not exist "node_modules\electron" (
  echo Installing electron and electron-builder for Windows packaging...
  call npm install --no-save --no-audit --no-fund electron electron-builder
  if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install electron / electron-builder.
    pause
    exit /b 1
  )
) else if not exist "node_modules\electron-builder" (
  call npm install --no-save --no-audit --no-fund electron-builder
  if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install electron-builder.
    pause
    exit /b 1
  )
)

echo.
echo [4/4] Building Windows EXE installer and portable executable...
call npx electron-builder --config electron-builder.yml --win
if %ERRORLEVEL% NEQ 0 (
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
