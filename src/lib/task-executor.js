const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { toLocalTimeString, log } = require('./utils');
const { CONFIG, writeJsonFile } = require('./task-manager');
const CliPluginManager = require('./cli-plugin-manager');

// 初始化 CLI 插件管理器
const cliPluginManager = new CliPluginManager();

/**
 * 执行单个任务
 * @param {Object} task - 任务对象
 * @param {string} task.cliType - CLI类型（claude, qoder等）
 */
async function executeTask(task) {
  return new Promise((resolve, reject) => {
    const timeout = task.timeout || CONFIG.taskTimeout;
    const workspace = task.workspace || path.join(__dirname, '..');
    const cliType = task.cliType || cliPluginManager.getDefaultCliType();

    log.info(`开始执行任务: ${task.id}${task.scheduled ? ' (定时任务)' : ''}`);
    log.info(`任务描述: ${task.prompt}`);
    log.info(`工作目录: ${workspace}`);
    log.info(`CLI类型: ${cliType}`);

    // 删除旧的 running.json（如果有）
    if (fs.existsSync(CONFIG.runningFile)) {
      fs.unlinkSync(CONFIG.runningFile);
    }

    // 记录运行中的任务
    writeJsonFile(CONFIG.runningFile, {
      ...task,
      startedAt: toLocalTimeString(new Date())
    });

    // 获取 CLI 插件并构建命令
    let commandConfig;
    try {
      const plugin = cliPluginManager.getPlugin(cliType);
      commandConfig = plugin.buildCommand(task);
    } catch (error) {
      log.error(`CLI插件错误: ${error.message}`);
      reject(error);
      return;
    }

    // 创建环境变量，移除 CLAUDECODE 以允许嵌套会话
    const childEnv = { ...process.env, NODE_ENV: 'production' };
    delete childEnv.CLAUDECODE;

    // 构建最终命令
    let spawnCommand;
    let spawnArgs;

    if (process.platform === 'win32') {
      // Windows: 使用 cmd.exe 并清除 CLAUDECODE
      spawnCommand = `cmd.exe`;
      spawnArgs = ['/c', `set CLAUDECODE= && ${commandConfig.command} ${commandConfig.args.join(' ')}`];
    } else {
      // Unix/Linux/Mac: 使用 env 清除 CLAUDECODE
      spawnCommand = 'env';
      spawnArgs = ['-u', 'CLAUDECODE', commandConfig.command, ...commandConfig.args];
    }

    log.info(`执行命令: ${commandConfig.command} ${commandConfig.args.join(' ')}`);

    const child = spawn(spawnCommand, spawnArgs, {
      cwd: commandConfig.cwd || workspace,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: childEnv,
      windowsHide: true
    });

    // 通过 stdin 传递 prompt（如果配置使用 stdin）
    if (commandConfig.stdinInput && child.stdin) {
      child.stdin.write(commandConfig.stdinInput);
      child.stdin.end();
    }

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

module.exports = { executeTask, cliPluginManager };
