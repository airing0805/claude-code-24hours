@echo off
chcp 65001 >nul
title Claude Code 自动任务执行器

echo ========================================
echo   Claude Code 自动任务执行器
echo ========================================
echo.

cd /d "e:\workspaces_2026_python\claude_code_cookbook\claude-code-24h-integration"

:: 初始化任务系统
echo [INFO] 初始化任务系统...
node scripts\init-tasks.js

:: 确保日志目录存在
if not exist "logs" mkdir logs

:: 检查 PM2 是否已运行
pm2 pid claude-runner >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] Claude Runner 已在 PM2 中运行
) else (
    echo [INFO] 正在启动 Claude Runner...
    pm2 start ecosystem.config.js
    pm2 save
)

echo.
pm2 status
echo.
echo ========================================
echo   任务管理命令:
echo ========================================
echo   pm2 status              - 查看运行状态
echo   pm2 logs claude-runner  - 查看实时日志
echo   pm2 restart claude-runner - 重启服务
echo   pm2 stop claude-runner  - 停止服务
echo.
echo   scripts\add-task.bat "任务"     - 添加新任务
echo   node src\add-task.js "..."  - 添加新任务(CLI)
echo.
echo   任务文件位置: tasks/queue.json
echo   完成任务: tasks/completed.json
echo   失败任务: tasks/failed.json
echo ========================================
echo.

cmd /k