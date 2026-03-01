const fs = require('fs');
const path = require('path');
const { toLocalTimeString, log } = require('./lib/utils');
const { CONFIG, readJsonFile, writeJsonFile, checkAndExecuteScheduledTasks, initScheduledTasks } = require('./lib/task-manager');
const { CronParser } = require('./lib/cron-parser');
const { executeTask } = require('./lib/task-executor');

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

  // 初始化 CronParser
  const cronParser = new CronParser();

  // 初始化定时任务
  initScheduledTasks(cronParser);

  let isProcessing = false;

  // 主循环
  setInterval(async () => {
    // 检查定时任务（每次都检查）
    checkAndExecuteScheduledTasks(cronParser);

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
