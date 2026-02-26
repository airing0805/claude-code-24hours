/**
 * 任务提交工具
 *
 * 使用方法：
 *   node add-task.js "你的任务描述"
 *   node add-task.js "任务描述" --workspace /path/to/project
 *   node add-task.js "任务描述" --timeout 600000
 */

const fs = require('fs');
const path = require('path');
const { toLocalTimeString } = require('./lib/utils');

const TASK_FILE = path.join(__dirname, '..', 'tasks', 'queue.json');

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const task = {
    id: `task-${Date.now()}`,
    prompt: '',
    workspace: path.join(__dirname, '..'),
    timeout: 600000,  // 默认 10 分钟
    autoApprove: false,
    allowedTools: null,
    createdAt: toLocalTimeString()
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--workspace' || arg === '-w') {
      task.workspace = args[++i];
    } else if (arg === '--timeout' || arg === '-t') {
      task.timeout = parseInt(args[++i], 10);
    } else if (arg === '--auto-approve' || arg === '-y') {
      task.autoApprove = true;
    } else if (arg === '--tools') {
      task.allowedTools = args[++i].split(',');
    } else if (!arg.startsWith('-')) {
      task.prompt = arg;
    }
  }

  return task;
}

// 添加任务到队列
function addTask(task) {
  if (!task.prompt) {
    console.error('错误：请提供任务描述');
    console.log('\n使用方法：');
    console.log('  node add-task.js "任务描述"');
    console.log('  node add-task.js "任务描述" --workspace /path/to/project');
    console.log('  node add-task.js "任务描述" --timeout 600000');
    console.log('  node add-task.js "任务描述" --auto-approve');
    process.exit(1);
  }

  // 读取现有队列
  let queue = { list: [] };
  if (fs.existsSync(TASK_FILE)) {
    const content = fs.readFileSync(TASK_FILE, 'utf8');
    queue = JSON.parse(content);
  }

  // 添加新任务
  queue.list.push(task);

  // 写回文件
  fs.writeFileSync(TASK_FILE, JSON.stringify(queue, null, 2));

  console.log('✅ 任务已添加到队列');
  console.log(`   ID: ${task.id}`);
  console.log(`   描述: ${task.prompt}`);
  console.log(`   工作目录: ${task.workspace}`);
  console.log(`   超时: ${task.timeout}ms`);
  console.log(`\n当前队列中有 ${queue.list.length} 个待执行任务`);
}

// 主函数
const task = parseArgs();
addTask(task);