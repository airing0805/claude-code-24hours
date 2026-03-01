@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

cd /d "e:\workspaces_2026_python\claude_code_cookbook\claude-code-24h-integration"

echo ========================================
echo   Claude Code 任务提交工具
echo ========================================
echo.

if "%~1"=="" (
    echo 使用方法: add-task.bat "任务描述" [选项]
    echo.
    echo 选项:
    echo   --workspace, -w    指定工作目录
    echo   --timeout, -t      超时时间(毫秒)
    echo   --auto-approve, -y 自动批准操作
    echo.
    echo 示例:
    echo   add-task.bat "检查代码中的TODO注释"
    echo   add-task.bat "运行测试" -w "e:/myproject"
    echo.
    set /p TASK_INPUT="请输入任务描述: "
) else (
    set "TASK_INPUT=%*"
)

if defined TASK_INPUT (
    node src\add-task.js !TASK_INPUT!
)

echo.
pause