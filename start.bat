@echo off
setlocal
echo ========================================================
echo   Drop Harbor - Self-Hosted File Drop
echo   Kitsune Technologies LLC
echo ========================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js was not found on your system.
    echo Please install Node.js (v18+) from https://nodejs.org/
    pause
    exit /b 1
)

if not exist node_modules (
    echo Installing dependencies (express, multer, etc.)...
    call npm install --omit=dev
)

if not exist .env (
    echo Creating default .env configuration...
    copy .env.example .env >nul
)

echo Starting Drop Harbor at http://localhost:3000 ...
start http://localhost:3000
node server.js
pause
