@echo off
title AI Workforce OS — Restart

echo.
echo  Killing all Node.js processes...
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1

echo  Freeing ports 3000 and 3001...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001 " 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)

timeout /t 2 /nobreak >nul

echo  Starting servers (pnpm dev)...
echo.

cd /d "%~dp0"
start "API + Web Dev Servers" cmd /k "pnpm dev"

echo  Done! Servers starting in new window.
echo  Frontend : http://localhost:3000
echo  API      : http://localhost:3001
echo  API Docs : http://localhost:3001/api/docs
echo.
pause
