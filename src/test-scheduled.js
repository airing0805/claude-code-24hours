/**
 * 测试定时任务：将已启用的任务放入队列
 */

const fs = require('fs');
const path = require('path');
const { toLocalTimeString } = require('./lib/utils');

const SCHEDULED_FILE = path.join(__dirname, '..', 'tasks', 'scheduled.json');
const QUEUE_FILE = path.join(__dirname, '..', 'tasks', 'queue.json');

// 读取定时任务
function readScheduledTasks() {
  const content = fs.readFileSync(SCHEDULED_FILE, 'utf8');
  const data = JSON.parse(content);
  return data.tasks || [];
}

// 读取队列
function readQueue() {
  if (!fs.existsSync(QUEUE_FILE)) {
    return { list: [] };
  }
  const content = fs.readFileSync(QUEUE_FILE, 'utf8');
  return JSON.parse(content);
}

// 写入队列
function writeQueue(queue) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

// 将定时任务转换为队列任务格式
function toQueueTask(scheduledTask) {
  return {
    id: `${scheduledTask.id}-${Date.now()}`,
    prompt: scheduledTask.prompt,
    workspace: scheduledTask.workspace,
    timeout: scheduledTask.timeout || 600000,
    autoApprove: scheduledTask.autoApprove || false,
    allowedTools: scheduledTask.allowedTools || null,
    createdAt: toLocalTimeString(),
    source: 'scheduled',
    sourceName: scheduledTask.name
  };
}

// 主函数
function main() {
  console.log('📋 读取定时任务...\n');

  const scheduledTasks = readScheduledTasks();
  const queue = readQueue();

  console.log(`定时任务总数: ${scheduledTasks.length}`);

  // 筛选已启用的任务
  const enabledTasks = scheduledTasks.filter(t => t.enabled);
  console.log(`已启用任务: ${enabledTasks.length}\n`);

  if (enabledTasks.length === 0) {
    console.log('没有已启用的任务。');
    return;
  }

  // 添加到队列
  const addedTasks = [];
  for (const task of enabledTasks) {
    const queueTask = toQueueTask(task);
    queue.list.push(queueTask);
    addedTasks.push(queueTask);

    console.log(`✅ 添加任务: ${task.name}`);
    console.log(`   ID: ${queueTask.id}`);
    console.log(`   Prompt: ${task.prompt.substring(0, 50)}${task.prompt.length > 50 ? '...' : ''}`);
    console.log(`   Workspace: ${task.workspace}`);
    console.log('');
  }

  // 写入队列
  writeQueue(queue);

  console.log(`\n📊 总结:`);
  console.log(`   已添加任务: ${addedTasks.length}`);
  console.log(`   队列中任务总数: ${queue.list.length}`);
}

main();
