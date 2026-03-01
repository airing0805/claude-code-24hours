const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { toLocalTimeString, log } = require('./lib/utils');
const { CONFIG } = require('./lib/task-manager');

/**
 * 执行单个任务
 */
async function executeTask(task) {
  return new Promise((resolve, reject) => {
    const timeout = task.timeout || CONFIG.taskTimeout;
    const workspace = task.workspace || path.join(__dirname, '..', '..');

    log.info(`开始执行任务: ${task.id}${task.scheduled ? ' (定时任务)' : ''}`);
    log.info(`任务描述: ${task.prompt}`);
    log.info(`工作目录: ${workspace}`);

    // 删除旧的 running.json（如果有）
    if (fs.existsSync(CONFIG.runningFile)) {
      fs.unlinkSync(CONFIG.runningFile);
    }

    // 记录运行中的任务
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

    // 由于 Windows 系统中 set 命令的行为不同，我们调整命令
    const command = process.platform === 'win32'
      ? `cmd.exe /c "set CLAUDECODE= && claude ${args.join(' ')}` 
      : `CLAUDECODE= claude ${args.join(' ')}`;

    const child = spawn(command, {
      cwd: workspace,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
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


// 确保 JSON 文件存在
function ensureFile(filePath, defaultContent = { list: [] }) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultContent, null, 2));
  }
}

// 读取 JSON 文件
function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { list: [] };
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    log.error(`读取文件失败 ${filePath}: ${err.message}`);
    return { list: [] };
  }
}

// 写入 JSON 文件
function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * 读取定时任务配置
 */
function readScheduledTasks() {
  try {
    if (!fs.existsSync(CONFIG.scheduledFile)) {
      return { tasks: [] };
    }
    const content = fs.readFileSync(CONFIG.scheduledFile, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    log.error(`读取定时任务配置失败: ${err.message}`);
    return { tasks: [] };
  }
}

/**
 * 写入定时任务配置
 */
function writeScheduledTasks(data) {
  fs.writeFileSync(CONFIG.scheduledFile, JSON.stringify(data, null, 2));
}

/**
 * 解析任务时间字符串（支持多种格式，正确处理 UTC 时间）
 * @param {string} timeStr - 时间字符串，支持多种格式
 * @returns {Date|null} 解析后的 Date 对象，失败返回 null
 */
function parseTaskTime(timeStr) {
  if (!timeStr) return null;

  // 检查是否是 UTC 时间（带 Z 后缀）
  const isUTC = timeStr.includes('Z');

  // 匹配 "YYYY-MM-DD HH:mm:ss" 或 "YYYY-MM-DDTHH:mm:ss" 或带毫秒的格式
  const match = timeStr.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z?$/);
  if (match) {
    let date;
    if (isUTC) {
      // UTC 时间：使用 Date.UTC 创建 UTC 时间戳（会自动转换为本地时间）
      date = new Date(Date.UTC(
        parseInt(match[1]),  // year
        parseInt(match[2]) - 1,  // month (0-11)
        parseInt(match[3]),  // day
        parseInt(match[4]),  // hour
        parseInt(match[5]),  // minute
        parseInt(match[6])   // second
      ));
    } else {
      // 本地时间：直接使用 new Date 构造函数
      date = new Date(
        parseInt(match[1]),
        parseInt(match[2]) - 1,
        parseInt(match[3]),
        parseInt(match[4]),
        parseInt(match[5]),
        parseInt(match[6])
      );
    }
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // 尝试直接解析（作为后备）
  const date = new Date(timeStr);
  if (!isNaN(date.getTime())) {
    return date;
  }

  return null;
}

/**
 * 检查并执行到期的定时任务
 */
function checkAndExecuteScheduledTasks(cronParser) {
  const scheduled = readScheduledTasks();
  const now = new Date();
  let updated = false;

  for (const task of scheduled.tasks) {
    // 跳过禁用的任务
    if (!task.enabled) {
      continue;
    }

    // 验证 cron 表达式
    if (!cronParser.isValid(task.cron)) {
      log.error(`无效的 cron 表达式: ${task.id} - ${task.cron}`);
      continue;
    }

    const nowStr = toLocalTimeString(now);
    const nowDate = new Date(now);

    // 检查是否有错过的执行
    let shouldExecute = false;

    if (!task.lastRun) {
      // 首次执行，检查当前时间是否匹配
      shouldExecute = cronParser.shouldRunNow(task.cron, nowDate);
    } else {
      // 有 lastRun，检查从 lastRun 到现在是否有错过的执行
      const lastRunDate = parseTaskTime(task.lastRun);

      if (!lastRunDate) {
        log.error(`无法解析 lastRun 时间: ${task.id} - ${task.lastRun}`);
        continue;
      }

      // 将时间截断到分钟级别进行比较
      const lastRunMinute = Math.floor(lastRunDate.getTime() / 60000) * 60000;
      const nowMinute = Math.floor(nowDate.getTime() / 60000) * 60000;

      // 如果 lastRun 和现在是不同的分钟，检查是否有错过的执行
      if (lastRunMinute !== nowMinute) {
        // 找到从 lastRun 之后应该执行的第一个时间
        const nextAfterLastRun = cronParser.getNextRunTime(task.cron, lastRunDate);

        // 将 nextAfterLastRun 也截断到分钟级别
        const nextAfterLastRunMinute = Math.floor(nextAfterLastRun.getTime() / 60000) * 60000;

        // 如果应该执行的时间 <= 现在（分钟级），说明错过了执行
        if (nextAfterLastRunMinute <= nowMinute && nextAfterLastRunMinute !== lastRunMinute) {
          shouldExecute = true;
        }
      }
    }

    if (shouldExecute) {
      // 将任务添加到队列
      addTaskToQueue({
        id: `${task.id}-${Date.now()}`,
        prompt: task.prompt,
        workspace: task.workspace || path.join(__dirname, '..', '..'),
        autoApprove: task.autoApprove || false,
        allowedTools: task.allowedTools || [],
        timeout: task.timeout || CONFIG.taskTimeout,
        scheduled: true,
        scheduledId: task.id
      });

      // 更新 lastRun 为当前时间
      task.lastRun = nowStr;
      log.info(`定时任务已加入队列: ${task.id} (${task.name})`);
      updated = true;
    }

    // 始终更新 nextRun（基于 lastRun 或当前时间）
    const baseTime = task.lastRun ? parseTaskTime(task.lastRun) : nowDate;
    const nextRun = cronParser.getNextRunTime(task.cron, baseTime || nowDate);
    task.nextRun = toLocalTimeString(nextRun);
    updated = true;
  }

  if (updated) {
    writeScheduledTasks(scheduled);
  }
}

/**
 * 添加任务到队列
 */
function addTaskToQueue(task) {
  const queue = readJsonFile(CONFIG.taskFile);
  if (!queue.list) {
    queue.list = [];
  }
  queue.list.push(task);
  writeJsonFile(CONFIG.taskFile, queue);
}

/**
 * 初始化定时任务（首次运行时计算 nextRun）
 */
function initScheduledTasks(cronParser) {
  const scheduled = readScheduledTasks();
  const now = new Date();
  let updated = false;

  for (const task of scheduled.tasks) {
    if (!task.nextRun && task.enabled) {
      try {
        // 使用 lastRun 作为基准（如果存在），否则使用当前时间
        const baseTime = task.lastRun ? parseTaskTime(task.lastRun) : now;
        const nextRun = cronParser.getNextRunTime(task.cron, baseTime || now);
        task.nextRun = toLocalTimeString(nextRun);
        updated = true;
        log.info(`定时任务初始化: ${task.id} - ${task.name} - 下次运行: ${task.nextRun}`);
      } catch (err) {
        log.error(`定时任务初始化失败: ${task.id} - ${err.message}`);
      }
    }
  }

  if (updated) {
    writeScheduledTasks(scheduled);
  }
}

module.exports = {
  CONFIG,
  ensureFile,
  readJsonFile,
  writeJsonFile,
  checkAndExecuteScheduledTasks,
  initScheduledTasks
};
/**
 * 简单的 Cron 表达式解析器
 * 支持: 秒 分 时 日 月 周
 * 示例: "0 9 * * *" (每天上午9点), "0 17 * * 5" (每周五下午5点)
 */
class CronParser {
  constructor() {
    this.timeZoneOffset = new Date().getTimezoneOffset() * 60000;
  }

  /**
   * 解析 cron 表达式为数组: [秒, 分, 时, 日, 月, 周]
   */
  parse(cronExpression) {
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length < 5 || parts.length > 6) {
      throw new Error(`无效的 cron 表达式: ${cronExpression}`);
    }

    // 支持 5 位或 6 位格式，6 位格式第一位是秒
    const [seconds, minutes, hours, days, months, weekdays] = parts.length === 6
      ? parts
      : ['0', ...parts];

    return {
      seconds: this.parseField(seconds, 0, 59),
      minutes: this.parseField(minutes, 0, 59),
      hours: this.parseField(hours, 0, 23),
      days: this.parseField(days, 1, 31),
      months: this.parseField(months, 1, 12),
      weekdays: this.parseField(weekdays, 0, 6)
    };
  }

  /**
   * 解析 cron 字段 (支持 *, 数字, 数字-数字, 数字除以步长, 星号除以步长)
   */
  parseField(field, min, max) {
    const values = new Set();

    for (const part of field.split(',')) {
      if (part === '*') {
        for (let i = min; i <= max; i++) values.add(i);
      } else if (part.includes('/')) {
        const [base, step] = part.split('/');
        const baseValues = base === '*' ? range(min, max) : this.parseRange(base, min, max);
        const stepNum = parseInt(step);
        for (let i = 0; i < baseValues.length; i += stepNum) {
          values.add(baseValues[i]);
        }
      } else if (part.includes('-')) {
        for (const v of this.parseRange(part, min, max)) {
          values.add(v);
        }
      } else {
        const num = parseInt(part);
        if (num < min || num > max) {
          throw new Error(`值 ${num} 超出范围 [${min}, ${max}]`);
        }
        values.add(num);
      }
    }

    return Array.from(values).sort((a, b) => a - b);
  }

  parseRange(range, min, max) {
    const [start, end] = range.split('-').map(Number);
    if (start < min || end > max || start > end) {
      throw new Error(`范围 ${range} 无效`);
    }
    const result = [];
    for (let i = start; i <= end; i++) result.push(i);
    return result;
  }

  /**
   * 计算下一次执行时间
   */
  getNextRunTime(cronExpression, fromDate = new Date()) {
    const schedule = this.parse(cronExpression);
    const date = new Date(fromDate);

    // 至少向前推 1 秒，避免立即触发
    date.setSeconds(date.getSeconds() + 1);

    // 最多向前推 4 年
    const maxIterations = 4 * 365 * 24 * 60 * 60;

    for (let i = 0; i < maxIterations; i++) {
      const seconds = date.getSeconds();
      const minutes = date.getMinutes();
      const hours = date.getHours();
      const day = date.getDate();
      const month = date.getMonth() + 1;
      const weekday = date.getDay();

      if (
        schedule.seconds.includes(seconds) &&
        schedule.minutes.includes(minutes) &&
        schedule.hours.includes(hours) &&
        schedule.days.includes(day) &&
        schedule.months.includes(month) &&
        schedule.weekdays.includes(weekday)
      ) {
        return new Date(date);
      }

      // 推进到下一秒
      date.setSeconds(date.getSeconds() + 1);
    }

    throw new Error(`无法计算下一次执行时间: ${cronExpression}`);
  }

  /**
   * 检查是否应该在当前时间执行
   * 注意：这是分钟级检查，因为轮询间隔是 10 秒，秒级匹配容易错过
   */
  shouldRunNow(cronExpression, now = new Date()) {
    const schedule = this.parse(cronExpression);
    const minutes = now.getMinutes();
    const hours = now.getHours();
    const day = now.getDate();
    const month = now.getMonth() + 1;
    const weekday = now.getDay();

    // 忽略秒，只检查分钟及以上的时间粒度
    // 这样即使轮询错过 0 秒时刻，也能在当前分钟内触发
    return (
      schedule.minutes.includes(minutes) &&
      schedule.hours.includes(hours) &&
      schedule.days.includes(day) &&
      schedule.months.includes(month) &&
      schedule.weekdays.includes(weekday)
    );
  }

  /**
   * 验证 cron 表达式是否有效
   */
  isValid(cronExpression) {
    try {
      this.parse(cronExpression);
      this.getNextRunTime(cronExpression);
      return true;
    } catch (e) {
      return false;
    }
  }
}

// 辅助函数
function range(min, max) {
  const result = [];
  for (let i = min; i <= max; i++) result.push(i);
  return result;
}

module.exports = { CronParser };
/**
 * Claude Code 自动任务执行器
 *
 * 功能：
 * - 从 tasks/queue.json 读取待执行任务
 * - 从 tasks/scheduled.json 读取定时任务（支持 cron 表达式）
 * - 按顺序执行每个任务
 * - 执行完成后移动到 tasks/completed.json
 * - 失败的任务移动到 tasks/failed.json
 */





// 确保 JSON 文件存在
function ensureFile(filePath, defaultContent = { list: [] }) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultContent, null, 2));
  }
}

// 读取 JSON 文件
function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { list: [] };
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    log.error(`读取文件失败 ${filePath}: ${err.message}`);
    return { list: [] };
  }
}

// 写入 JSON 文件
function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ========== 定时任务处理 ==========

/**
 * 读取定时任务配置
 */
function readScheduledTasks() {
  try {
    if (!fs.existsSync(CONFIG.scheduledFile)) {
      return { tasks: [] };
    }
    const content = fs.readFileSync(CONFIG.scheduledFile, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    log.error(`读取定时任务配置失败: ${err.message}`);
    return { tasks: [] };
  }
}

/**
 * 写入定时任务配置
 */
function writeScheduledTasks(data) {
  fs.writeFileSync(CONFIG.scheduledFile, JSON.stringify(data, null, 2));
}

/**
 * 解析任务时间字符串（支持多种格式，正确处理 UTC 时间）
 * @param {string} timeStr - 时间字符串，支持多种格式
 * @returns {Date|null} 解析后的 Date 对象，失败返回 null
 */
function parseTaskTime(timeStr) {
  if (!timeStr) return null;

  // 检查是否是 UTC 时间（带 Z 后缀）
  const isUTC = timeStr.includes('Z');

  // 匹配 "YYYY-MM-DD HH:mm:ss" 或 "YYYY-MM-DDTHH:mm:ss" 或带毫秒的格式
  const match = timeStr.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z?$/);
  if (match) {
    let date;
    if (isUTC) {
      // UTC 时间：使用 Date.UTC 创建 UTC 时间戳（会自动转换为本地时间）
      date = new Date(Date.UTC(
        parseInt(match[1]),  // year
        parseInt(match[2]) - 1,  // month (0-11)
        parseInt(match[3]),  // day
        parseInt(match[4]),  // hour
        parseInt(match[5]),  // minute
        parseInt(match[6])   // second
      ));
    } else {
      // 本地时间：直接使用 new Date 构造函数
      date = new Date(
        parseInt(match[1]),
        parseInt(match[2]) - 1,
        parseInt(match[3]),
        parseInt(match[4]),
        parseInt(match[5]),
        parseInt(match[6])
      );
    }
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // 尝试直接解析（作为后备）
  const date = new Date(timeStr);
  if (!isNaN(date.getTime())) {
    return date;
  }

  return null;
}

/**
 * 检查并执行到期的定时任务
 */
function checkAndExecuteScheduledTasks() {
  const scheduled = readScheduledTasks();
  const now = new Date();
  let updated = false;

  for (const task of scheduled.tasks) {
    // 跳过禁用的任务
    if (!task.enabled) {
      continue;
    }

    // 验证 cron 表达式
    if (!cronParser.isValid(task.cron)) {
      log.error(`无效的 cron 表达式: ${task.id} - ${task.cron}`);
      continue;
    }

    const nowStr = toLocalTimeString(now);
    const nowDate = new Date(now);

    // 检查是否有错过的执行
    let shouldExecute = false;

    if (!task.lastRun) {
      // 首次执行，检查当前时间是否匹配
      shouldExecute = cronParser.shouldRunNow(task.cron, nowDate);
    } else {
      // 有 lastRun，检查从 lastRun 到现在是否有错过的执行
      const lastRunDate = parseTaskTime(task.lastRun);

      if (!lastRunDate) {
        log.error(`无法解析 lastRun 时间: ${task.id} - ${task.lastRun}`);
        continue;
      }

      // 将时间截断到分钟级别进行比较
      const lastRunMinute = Math.floor(lastRunDate.getTime() / 60000) * 60000;
      const nowMinute = Math.floor(nowDate.getTime() / 60000) * 60000;

      // 如果 lastRun 和现在是不同的分钟，检查是否有错过的执行
      if (lastRunMinute !== nowMinute) {
        // 找到从 lastRun 之后应该执行的第一个时间
        const nextAfterLastRun = cronParser.getNextRunTime(task.cron, lastRunDate);

        // 将 nextAfterLastRun 也截断到分钟级别
        const nextAfterLastRunMinute = Math.floor(nextAfterLastRun.getTime() / 60000) * 60000;

        // 如果应该执行的时间 <= 现在（分钟级），说明错过了执行
        if (nextAfterLastRunMinute <= nowMinute && nextAfterLastRunMinute !== lastRunMinute) {
          shouldExecute = true;
        }
      }
    }

    if (shouldExecute) {
      // 将任务添加到队列
      addTaskToQueue({
        id: `${task.id}-${Date.now()}`,
        prompt: task.prompt,
        workspace: task.workspace || path.join(__dirname, '..'),
        autoApprove: task.autoApprove || false,
        allowedTools: task.allowedTools || [],
        timeout: task.timeout || CONFIG.taskTimeout,
        scheduled: true,
        scheduledId: task.id
      });

      // 更新 lastRun 为当前时间
      task.lastRun = nowStr;
      log.info(`定时任务已加入队列: ${task.id} (${task.name})`);
      updated = true;
    }

    // 始终更新 nextRun（基于 lastRun 或当前时间）
    const baseTime = task.lastRun ? parseTaskTime(task.lastRun) : nowDate;
    const nextRun = cronParser.getNextRunTime(task.cron, baseTime || nowDate);
    task.nextRun = toLocalTimeString(nextRun);
    updated = true;
  }

  if (updated) {
    writeScheduledTasks(scheduled);
  }
}

/**
 * 添加任务到队列
 */
function addTaskToQueue(task) {
  const queue = readJsonFile(CONFIG.taskFile);
  if (!queue.list) {
    queue.list = [];
  }
  queue.list.push(task);
  writeJsonFile(CONFIG.taskFile, queue);
}

/**
 * 初始化定时任务（首次运行时计算 nextRun）
 */
function initScheduledTasks() {
  const scheduled = readScheduledTasks();
  const now = new Date();
  let updated = false;

  for (const task of scheduled.tasks) {
    if (!task.nextRun && task.enabled) {
      try {
        // 使用 lastRun 作为基准（如果存在），否则使用当前时间
        const baseTime = task.lastRun ? parseTaskTime(task.lastRun) : now;
        const nextRun = cronParser.getNextRunTime(task.cron, baseTime || now);
        task.nextRun = toLocalTimeString(nextRun);
        updated = true;
        log.info(`定时任务初始化: ${task.id} - ${task.name} - 下次运行: ${task.nextRun}`);
      } catch (err) {
        log.error(`定时任务初始化失败: ${task.id} - ${err.message}`);
      }
    }
  }

  if (updated) {
    writeScheduledTasks(scheduled);
  }
}

// 执行单个任务
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

// 主循环
async function main() {
  log.info('='.repeat(50));
  log.info('Claude Code 自动任务执行器启动');
  log.info('='.repeat(50));
  log.info(`任务文件: ${CONFIG.taskFile}`);
  log.info(`定时任务文件: ${CONFIG.scheduledFile}`);
  log.info(`轮询间隔: ${CONFIG.pollInterval}ms`);
  log.info(`任务超时: ${CONFIG.taskTimeout}ms`);

  // 确保所有文件存在
  ensureFile(CONFIG.taskFile);
  ensureFile(CONFIG.completedFile);
  ensureFile(CONFIG.failedFile);
  ensureFile(CONFIG.scheduledFile);

  // 清空运行文件
  if (fs.existsSync(CONFIG.runningFile)) {
    fs.unlinkSync(CONFIG.runningFile);
  }

  // 初始化定时任务
  initScheduledTasks();

  let isProcessing = false;

  // 主循环
  setInterval(async () => {
    // 检查定时任务（每次都检查）
    checkAndExecuteScheduledTasks();

    if (isProcessing) {
      return;  // 正在处理任务，跳过
    }

    try {
      const queue = readJsonFile(CONFIG.taskFile);

      if (queue.list && queue.list.length > 0) {
        isProcessing = true;
        const task = queue.list[0];  // 取第一个任务

        try {
          await executeTask(task);

          // 成功：移动到已完成列表
          const completed = readJsonFile(CONFIG.completedFile);
          completed.list.push({
            ...task,
            completedAt: toLocalTimeString(new Date()),
            status: 'success'
          });
          writeJsonFile(CONFIG.completedFile, completed);
          log.success(`任务完成: ${task.id}`);

        } catch (err) {
          // 失败处理
          log.error(`任务执行失败: ${task.id} - ${err.message}`);

          const retries = (task.retries || 0) + 1;

          if (retries < CONFIG.maxRetries) {
            // 重试：更新重试次数，放回队列
            task.retries = retries;
            log.info(`任务将在下次轮询时重试 (${retries}/${CONFIG.maxRetries}): ${task.id}`);
          } else {
            // 超过最大重试次数：移动到失败列表（不再放回队列）
            const failed = readJsonFile(CONFIG.failedFile);
            failed.list.push({
              ...task,
              failedAt: toLocalTimeString(new Date()),
              error: err.message,
              retries: retries,
              status: 'failed'
            });
            writeJsonFile(CONFIG.failedFile, failed);
            log.error(`任务最终失败: ${task.id} - ${err.message}`);
          }
        }

        // 清空 running.json
        writeJsonFile(CONFIG.runningFile, {});

        // 从队列中删除已处理的任务
        const updatedQueue = readJsonFile(CONFIG.taskFile);
        updatedQueue.list.shift();  // 移除已处理的任务
        writeJsonFile(CONFIG.taskFile, updatedQueue);

        isProcessing = false;
      }
    } catch (err) {
      log.error(`主循环错误: ${err.message}`);
      isProcessing = false;
    }
  }, CONFIG.pollInterval);

  log.info('执行器就绪，等待任务...');
}

// 优雅退出
process.on('SIGINT', () => {
  log.info('收到 SIGINT 信号，正在退出...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('收到 SIGTERM 信号，正在退出...');
  process.exit(0);
});

// 启动
main().catch((err) => {
  log.error(`启动失败: ${err.message}`);
  process.exit(1);
});