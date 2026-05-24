@echo off
title Start Fresh Dev Server
echo ====================================================
echo  Closing all running Node.js servers (Vite/Next.js) 
echo ====================================================

echo 1. Stopping any processes listening on ports 3000, 3001, 3002...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo Killing process %%a on port 3000
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001 ^| findstr LISTENING') do (
    echo Killing process %%a on port 3001
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3002 ^| findstr LISTENING') do (
    echo Killing process %%a on port 3002
    taskkill /F /PID %%a >nul 2>&1
)

echo 2. Terminating all leftover node.exe processes...
taskkill /F /IM node.exe >nul 2>&1

echo 3. Cleaning Next.js stale locks...
if exist .next\dev\lock (
    del /f /q .next\dev\lock >nul 2>&1
)

echo 4. Generating Prisma Client...
call npx prisma generate

echo ====================================================
echo  Starting Next.js Dev Server on Port 3000...
echo ====================================================
npm run dev
