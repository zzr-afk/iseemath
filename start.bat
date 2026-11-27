@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

title iseemath

echo.
echo   iseemath - 本地启动
echo   ----------------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 goto :no_node

set "PM="
where pnpm >nul 2>nul && set "PM=pnpm"
if not defined PM (
  echo [提示] 未找到 pnpm，改用 npm。
  set "PM=npm"
)

if not exist "node_modules\vite\package.json" (
  echo [1/2] 首次运行，正在安装依赖...
  call %PM% install
  if errorlevel 1 goto :install_failed
)

set "OPEN=--open"
if /i "%~1"=="--no-open" set "OPEN="

echo [2/2] 启动开发服务器...
echo       浏览器会自动打开；关闭本窗口或按 Ctrl+C 可停止。
echo.
if "%PM%"=="pnpm" (
  call pnpm run dev %OPEN%
) else (
  call npm run dev -- %OPEN%
)
if errorlevel 1 goto :run_failed
exit /b 0

:no_node
echo [错误] 未找到 Node.js。
echo        请先安装 Node.js 24（https://nodejs.org/），再重新运行本脚本。
goto :pause_exit

:install_failed
echo.
echo [错误] 依赖安装失败，请查看上方日志。
goto :pause_exit

:run_failed
echo.
echo [错误] 开发服务器启动失败，请查看上方日志。
goto :pause_exit

:pause_exit
echo.
pause
exit /b 1
