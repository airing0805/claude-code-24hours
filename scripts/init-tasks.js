/**
 * 任务系统初始化脚本
 * 创建必要的任务文件和目录结构
 */

const fs = require('fs');
const path = require('path');

const TASKS_DIR = path.join(__dirname, '..', 'tasks');
const LOGS_DIR = path.join(__dirname, '..', 'logs');

// 确保目录存在
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✅ 创建目录: ${dir}`);
  }
}

// 创建默认任务文件
function createTaskFile(filename, content = { list: [] }) {
  const filepath = path.join(TASKS_DIR, filename);
  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, JSON.stringify(content, null, 2));
    console.log(`✅ 创建任务文件: ${filename}`);
  }
}

// 初始化
function init() {
  console.log('🔧 初始化 Claude Code 24小时任务系统...');
  
  // 创建目录
  ensureDir(TASKS_DIR);
  ensureDir(LOGS_DIR);
  
  // 创建任务文件
  createTaskFile('queue.json');
  createTaskFile('completed.json');
  createTaskFile('failed.json');
  
  // 清理运行状态文件（如果存在）
  const runningFile = path.join(TASKS_DIR, 'running.json');
  if (fs.existsSync(runningFile)) {
    fs.unlinkSync(runningFile);
    console.log('🧹 清理运行状态文件');
  }
  
  console.log('✅ 初始化完成！');
  console.log('\n📋 目录结构:');
  console.log('   tasks/queue.json      - 待执行任务队列');
  console.log('   tasks/completed.json  - 已完成任务记录');
  console.log('   tasks/failed.json     - 失败任务记录');
  console.log('   logs/                 - 日志目录');
}

// 执行初始化
init();