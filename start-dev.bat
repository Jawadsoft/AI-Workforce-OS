@echo off
title AI Workforce OS - Dev Servers

echo Killing existing processes on ports 3000 and 3001...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)

timeout /t 2 /nobreak >nul

echo Starting API server (port 3001)...
start "API Server" cmd /k "cd /d %~dp0apps\api && pnpm dev"

echo Waiting for API to compile...
timeout /t 5 /nobreak >nul

echo Starting Frontend server (port 3000)...
start "Frontend Server" cmd /k "cd /d %~dp0apps\web && pnpm dev"

echo.
echo Both servers are starting...
echo   API:      http://localhost:3001
echo   Frontend: http://localhost:3000
echo   Swagger:  http://localhost:3001/api/docs
echo.
pause
