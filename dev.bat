@echo off
REM dev.bat - 启动 Vite dev server
REM 用法:双击,或 cmd /c e:\git\xianni-game-vslike\dev.bat
setlocal
set "PATH=%LOCALAPPDATA%\Temp\nodejs-portable\node-v22.23.3-win-x64;%PATH%"
cd /d "%~dp0"
npm.cmd run dev
endlocal
