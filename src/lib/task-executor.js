const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { toLocalTimeString, log } = require('./utils');
const { CONFIG } = require('./task-manager');

/**
 * 执行单个任务
 */
async function executeTask(task) {
  return new Promise((resolve, reject) => {
    const timeout = task.timeout || CONFIG.taskTimeout;
    const workspace = task.workspace || path.join(__dirname, '..');

    log.info(`开始执行任务: ${task.id}${task.scheduled ? ' (定时任务)' : ''}`);
    log.info(`任务描述: ${task.prompt}`);
    log.info(`工作目录: ${workspace}`);

    // 删除旧的 running.json（如果有）
    if (fs.existsSync(CONFIG.runningFile)) {
      fs.unlinkSync(CONFIG.runningFile);
    }

    // 记录运行中的任务
    const { writeJsonFile } = require('./task-manager');
    writeJsonFile(CONFIG.runningFile, {
      ...task,
      startedAt: toLocalTimeString(new Date())
    });

    // 构建 Claude Code 命令
    const args = [];

    // 添加其他参数
    if (task.allowedTools && task.allowedTools.length > 0) {
      args.push('--allowedTools', task.allowedTools.join(','));
    }

    // 是否自动确认（危险操作需要手动确认）
    if (task.autoApprove) {
      args.push('--dangerously-skip-permissions');
    }

    // 创建环境变量，移除 CLAUDECODE 以允许嵌套会话
    const childEnv = { ...process.env, NODE_ENV: 'production' };
    delete childEnv.CLAUDECODE;

    log.info(`执行命令: claude ${args.join(' ')} < prompt via stdin`);

    // 使用 stdin 传递 prompt，避免 shell 解析中文参数的问题
    // 在 shell 模式下，显式设置命令字符串以清除 CLAUDECODE
    const command = 'set CLAUDECODE= && claude ' + args.join(' ');
    const child = spawn(command, {
      cwd: workspace,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,  // Windows 需要 shell 才能找到 claude 命令
      env: childEnv,
      windowsHide: true
    });

    // 通过 stdin 传递 prompt
    if (task.prompt) {
      child.stdin?.write(task.prompt);
    }
    child.stdin?.end();

    // 捕获输出
    child.stdout?.on('data', (data) => {
      log.info(`[STDOUT] ${data.toString().trim()}`);
    });

    child.stderr?.on('data', (data) => {
      log.info(`[STDERR] ${data.toString().trim()}`);
    });

    // 超时处理
    const timer = setTimeout(() => {
      log.error(`任务超时 (${timeout}ms)，正在终止...`);
      child.kill('SIGTERM');
      reject(new Error(`Task timeout after ${timeout}ms`));
    }, timeout);

    child.on('error', (err) => {
      clearTimeout(timer);
      log.error(`任务执行失败: ${err.message}`);
      reject(err);
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timer);

      if (signal) {
        reject(new Error(`Process killed by signal: ${signal}`));
      } else if (code !== 0) {
        reject(new Error(`Process exited with code: ${code}`));
      } else {
        resolve();
      }
    });
  });
}

module.exports = { executeTask };