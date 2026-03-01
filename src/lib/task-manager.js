const fs = require('fs');
const path = require('path');
const { toLocalTimeString, log } = require('./utils');
const { CronParser } = require('./cron-parser');

const CONFIG = {
  taskFile: path.join(__dirname, '..', '..', 'tasks', 'queue.json'),
  completedFile: path.join(__dirname, '..', '..', 'tasks', 'completed.json'),
  failedFile: path.join(__dirname, '..', '..', 'tasks', 'failed.json'),
  runningFile: path.join(__dirname, '..', '..', 'tasks', 'running.json'),
  scheduledFile: path.join(__dirname, '..', '..', 'tasks', 'scheduled.json'),
  pollInterval: 10000,  // 10秒检查一次
  maxRetries: 2,        // 最大重试次数
  taskTimeout: 600000,  // 单个任务超时 10 分钟
};

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
  parseTaskTime,
  readScheduledTasks,
  writeScheduledTasks,
  checkAndExecuteScheduledTasks,
  addTaskToQueue,
  initScheduledTasks
};