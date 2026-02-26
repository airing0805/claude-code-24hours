# PM2 与 Claude Code 结合 24 小时运行落地实践

## 1. 系统架构概述

### 1.1 整体架构设计

本系统采用 **任务驱动 + 进程守护** 的架构模式，通过以下组件协同工作实现 24/7 自动化任务处理：

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   任务提交层     │    │   任务调度层      │    │   执行引擎层     │
│                 │    │                  │    │                 │
│ • add-task.js   │───▶│ • auto-runner.js │───▶│ • claude code   │
│ • add-task.bat  │    │ • PM2 守护       │    │ • Node.js 运行时 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   任务队列管理   │    │   进程监控管理    │    │   日志与错误处理 │
│                 │    │                  │    │                 │
│ • queue.json    │    │ • PM2 Dashboard  │    │ • logs/ 目录     │
│ • completed.json│    │ • 自动重启机制   │    │ • failed.json   │
│ • failed.json   │    │ • 内存监控       │    │ • 错误重试       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### 1.2 核心优势

- **高可用性**：PM2 确保 `auto-runner.js` 进程永不中断
- **自动化处理**：任务队列机制支持异步、批量任务处理
- **故障自愈**：进程崩溃自动重启，任务失败自动重试
- **资源优化**：内存限制和定时重启防止资源泄漏
- **运维友好**：完善的日志管理和监控接口

## 2. 环境准备与安装

### 2.1 前置依赖

```bash
# Node.js (推荐 v18+)
node --version

# PM2 全局安装
npm install -g pm2

# Claude CLI 已配置并可执行
claude --version
```

### 2.2 项目结构

```
claude-code-24h-integration/
├── ecosystem.config.js      # PM2 配置文件
├── src/
│   ├── auto-runner.js       # 任务调度核心
│   └── add-task.js          # 任务提交工具
├── scripts/
│   ├── add-task.bat         # Windows 任务提交脚本
│   └── start-pm2.bat        # PM2 启动脚本
├── tasks/
│   ├── queue.json           # 待执行任务队列
│   ├── completed.json       # 已完成任务记录
│   ├── failed.json          # 失败任务记录
│   └── running.json         # 当前运行任务状态
├── logs/
│   ├── runner-out.log       # 标准输出日志
│   └── runner-error.log     # 错误日志
└── docs/
    └── PM2与Claude_Code结合24小时运行落地实践.md
```

## 3. 核心组件详解

### 3.1 PM2 配置 (`ecosystem.config.js`)

```javascript
module.exports = {
  apps: [{
    name: 'claude-runner',
    script: './src/auto-runner.js',
    cwd: 'e:/workspaces_2026_python/claude_code_cookbook/claude-code-24h-integration',
    interpreter: 'node',

    // 进程管理
    autorestart: true,        // 自动重启
    max_restarts: 30,         // 最大重启次数
    restart_delay: 10000,     // 重启延迟 10秒
    watch: false,             // 不监听文件变化

    // 内存限制（超过500M自动重启）
    max_memory_restart: '5000M',

    // 日志配置
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    out_file: './logs/runner-out.log',
    error_file: './logs/runner-error.log',

    // 环境变量
    env: {
      NODE_ENV: 'production'
    },

    // 定时重启（每天中午12点清理内存）
    cron_restart: '0 12 * * *'
  }]
}
```

#### 配置要点说明

- **内存限制**：设置 `max_memory_restart: '5000M'` 防止内存泄漏导致系统崩溃
- **定时重启**：`cron_restart: '0 12 * * *'` 每天中午自动重启，清理累积的内存占用
- **日志分离**：标准输出和错误日志分别记录，便于问题排查
- **工作目录**：明确指定 `cwd` 确保路径一致性

### 3.2 任务调度器 (`src/auto-runner.js`)

任务调度器实现了以下关键功能：

#### 核心逻辑流程

1. **轮询检查**：每10秒检查 `tasks/queue.json` 是否有新任务
2. **任务执行**：调用 `claude code` 命令执行任务
3. **超时控制**：单个任务默认超时10分钟，可配置
4. **结果处理**：
   - 成功：移动到 `completed.json`
   - 失败：重试2次后移动到 `failed.json`
5. **状态跟踪**：实时更新 `running.json` 记录当前执行状态

#### 关键特性

- **并发控制**：单线程顺序执行，避免资源竞争
- **优雅退出**：捕获 `SIGINT` 和 `SIGTERM` 信号，确保数据完整性
- **错误隔离**：单个任务失败不影响整体服务运行
- **实时日志**：继承子进程的 stdout/stderr，便于调试

### 3.3 任务提交工具 (`src/add-task.js`)

提供灵活的任务提交方式：

```bash
# 基本用法
node src/add-task.js "修复用户登录页面的响应式布局问题"

# 指定工作目录
node src/add-task.js "优化API性能" --workspace /path/to/project

# 设置超时时间（毫秒）
node src/add-task.js "数据迁移任务" --timeout 1800000

# 自动确认（跳过权限询问）
node src/add-task.js "紧急修复" --auto-approve

# 限制可用工具
node src/add-task.js "只读操作" --tools read_file,search_codebase
```

## 4. 部署与启动流程

### 4.1 初始化部署

```bash
# 1. 进入整合目录
cd e:\workspaces_2026_python\claude_code_cookbook\claude-code-24h-integration

# 2. 创建日志目录（如果不存在）
mkdir logs

# 3. 初始化任务文件
node src/add-task.js "初始化任务" --auto-approve

# 4. 启动PM2服务
pm2 start ecosystem.config.js

# 5. 保存PM2配置（开机自启需要）
pm2 save
```

### 4.2 Windows 开机自启配置

使用提供的批处理脚本：

```batch
:: 在scripts目录中运行
scripts\start-pm2.bat
```

### 4.3 启动验证

运行 `scripts\start-pm2.bat` 脚本，验证服务状态：

```batch
========================================
  Claude Code 自动任务执行器
========================================

[INFO] 正在启动 Claude Runner...
[PM2] Applying action startProcessId on app [claude-runner](ids: [ 0 ])
[PM2] [claude-runner](0) ✓

┌────┬────────────────────┬──────────┬──────┬───────────┬──────────┬──────────┐
│ id │ name               │ mode     │ ↺    │ status    │ cpu      │ memory   │
├────┼────────────────────┼──────────┼──────┼───────────┼──────────┼──────────┤
│ 0  │ claude-runner      │ fork     │ 0    │ online    │ 0%       │ 32.5mb   │
└────┴────────────────────┴──────────┴──────┴───────────┴──────────┴──────────┘

========================================
  任务管理命令:
========================================
  pm2 status              - 查看运行状态
  pm2 logs claude-runner  - 查看实时日志
  pm2 restart claude-runner - 重启服务
  pm2 stop claude-runner  - 停止服务

  scripts\add-task.bat "任务"     - 添加新任务
  node src\add-task.js "..."  - 添加新任务(CLI)

  任务文件位置: tasks/queue.json
  完成任务: tasks/completed.json
  失败任务: tasks/failed.json
========================================
```

## 5. 运维管理最佳实践

### 5.1 日常监控

#### 查看服务状态
```bash
# 查看所有PM2进程
pm2 list

# 实时监控资源使用
pm2 monit

# 查看详细信息
pm2 describe claude-runner
```

#### 日志管理
```bash
# 查看实时日志
pm2 logs claude-runner

# 查看标准输出日志
tail -f logs/runner-out.log

# 查看错误日志
tail -f logs/runner-error.log

# 日志轮转（防止磁盘占满）
logrotate -f /etc/logrotate.d/pm2
```

### 5.2 故障处理

#### 常见问题及解决方案

| 问题现象 | 可能原因 | 解决方案 |
|---------|---------|---------|
| PM2 进程离线 | 内存不足或代码异常 | `pm2 restart claude-runner` |
| 任务卡住不执行 | 队列文件损坏 | 检查 `tasks/queue.json` 格式 |
| Claude CLI 找不到 | PATH 环境变量问题 | 在 PM2 配置中设置完整 PATH |
| 内存持续增长 | 内存泄漏 | 调整 `max_memory_restart` 值 |

#### 紧急恢复流程

```bash
# 1. 停止服务
pm2 stop claude-runner

# 2. 清理异常状态文件
del tasks\running.json

# 3. 检查队列文件格式
# 使用 JSON 验证工具检查 tasks/queue.json

# 4. 重新启动
pm2 start claude-runner
```

### 5.3 性能优化

#### 内存管理策略

- **合理设置内存限制**：根据服务器配置调整 `max_memory_restart`
- **定期重启**：利用 `cron_restart` 配置每日清理
- **任务分批**：避免一次性提交大量复杂任务

#### 任务队列优化

```javascript
// 在 auto-runner.js 中可以添加优先级支持
const task = {
  ...originalTask,
  priority: task.priority || 0, // 0=normal, 1=high, -1=low
  deadline: task.deadline || null // 截止时间
};

// 按优先级排序队列
queue.list.sort((a, b) => {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }
  return new Date(a.createdAt) - new Date(b.createdAt);
});
```

## 6. 扩展与定制

### 6.1 通知集成

添加任务完成/失败通知：

```javascript
// 在 auto-runner.js 的 executeTask 函数后添加
async function sendNotification(task, status, error = null) {
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK;
  if (!webhookUrl) return;

  const message = {
    content: `**${status === 'success' ? '✅' : '❌'} Claude Code 任务 ${status}**\n` +
             `**任务**: ${task.prompt}\n` +
             `**ID**: ${task.id}\n` +
             `${error ? `**错误**: ${error}\n` : ''}` +
             `**时间**: ${new Date().toLocaleString()}`
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
  } catch (err) {
    log.error(`通知发送失败: ${err.message}`);
  }
}
```

### 6.2 Web 管理界面

基于 PM2 的 HTTP API 创建简单管理界面：

```javascript
// 在 ecosystem.config.js 中启用 Web API
module.exports = {
  apps: [{
    // ... 其他配置 ...
    env: {
      NODE_ENV: 'production',
      PM2_SERVE: 'true'
    }
  }]
}

// 启动 Web 界面
pm2 web
// 访问 http://localhost:9615 查看PM2 Dashboard
```

### 6.3 多实例部署

对于高负载场景，可以部署多个实例：

```javascript
// ecosystem.config.js - 多实例配置
module.exports = {
  apps: [
    {
      name: 'claude-runner-1',
      script: './src/auto-runner.js',
      args: '--instance-id 1',
      // ... 其他配置
    },
    {
      name: 'claude-runner-2', 
      script: './src/auto-runner.js',
      args: '--instance-id 2',
      // ... 其他配置
    }
  ]
}
```

## 7. 安全考虑

### 7.1 权限控制

- **谨慎使用 `--auto-approve`**：仅在可信环境中使用
- **工具白名单**：通过 `--tools` 参数限制可用工具
- **工作目录限制**：验证 `--workspace` 参数的安全性

### 7.2 环境隔离

```javascript
// 在 auto-runner.js 中添加安全检查
function validateWorkspace(workspace) {
  const allowedRoot = path.resolve(__dirname, '..');
  const resolvedWorkspace = path.resolve(workspace);
  
  if (!resolvedWorkspace.startsWith(allowedRoot)) {
    throw new Error('工作目录超出允许范围');
  }
  
  return resolvedWorkspace;
}
```

### 7.3 日志审计

- **敏感信息过滤**：在日志中避免记录密码、API密钥等
- **定期备份**：保留重要任务的历史记录
- **访问控制**：限制对日志文件的访问权限

## 8. 实际应用案例

### 8.1 自动化代码审查

```bash
# 提交代码审查任务
node src/add-task.js "审查最近的PR，重点关注安全性问题" \
  --workspace /path/to/repo \
  --timeout 300000 \
  --tools read_file,search_codebase,grep_code
```

### 8.2 定时维护任务

```bash
# 每日凌晨执行的维护任务
0 2 * * * node src/add-task.js "清理临时文件和缓存" --auto-approve
```

### 8.3 紧急修复流程

```bash
# 生产环境紧急修复
node src/add-task.js "修复生产环境的登录bug" \
  --workspace /prod/app \
  --timeout 600000 \
  --auto-approve \
  --priority 1
```

## 9. 总结与建议

### 9.1 成功要素

1. **合理的资源配置**：根据任务复杂度调整内存和超时设置
2. **完善的监控体系**：实时关注服务状态和任务执行情况
3. **渐进式部署**：先在测试环境验证，再部署到生产环境
4. **文档化流程**：记录常见问题和解决方案

### 9.2 持续改进方向

- **智能调度**：基于任务类型和资源使用情况动态调整
- **可视化界面**：提供任务提交、监控、管理的Web界面
- **集群支持**：支持多节点分布式任务处理
- **AI优化**：利用Claude自身能力优化任务执行策略

### 9.3 最佳实践清单

- ✅ 使用配置文件而非命令行参数管理PM2
- ✅ 设置合理的内存限制和超时时间
- ✅ 定期检查和清理日志文件
- ✅ 谨慎使用自动确认功能
- ✅ 建立完善的错误处理和通知机制
- ✅ 定期备份重要的任务历史记录
- ✅ 在生产环境部署前充分测试

通过以上实践，您可以构建一个稳定、可靠、高效的24小时自动化任务处理系统，充分发挥Claude Code的强大能力，同时确保系统的高可用性和可维护性。

---

## 10. 定时任务机制详解

### 10.1 CronParser 类设计

系统内置了一个轻量级的 Cron 表达式解析器，无需额外依赖：

```javascript
class CronParser {
  constructor() {
    this.timeZoneOffset = new Date().getTimezoneOffset() * 60000;
  }

  // 解析 cron 表达式为结构化对象
  parse(expression) → { seconds[], minutes[], hours[], days[], months[], weekdays[] }

  // 计算下一次执行时间
  getNextRunTime(expression, fromDate) → Date

  // 检查当前时间是否匹配（分钟级）
  shouldRunNow(expression, now) → boolean

  // 验证表达式有效性
  isValid(expression) → boolean
}
```

### 10.2 Cron 表达式支持

| 格式 | 示例 | 说明 |
|------|------|------|
| 5位 | `0 9 * * *` | 每天 9:00 |
| 6位 | `0 0 9 * * *` | 每天 9:00:00 |
| 间隔 | `*/20 * * * *` | 每 20 分钟 |
| 范围 | `0 9-17 * * *` | 9:00-17:00 每小时 |
| 组合 | `0 9,12,18 * * *` | 每天 9:00, 12:00, 18:00 |
| 周几 | `0 9 * * 1-5` | 周一到周五 9:00 |

### 10.3 触发逻辑流程

```
每 10 秒轮询：
  │
  ├── 遍历 scheduled.json 中的所有任务
  │
  ├── 跳过 disabled 任务
  │
  ├── 检查 cron 表达式是否有效
  │
  ├── 计算：上次执行后是否有错过的执行？
  │     │
  │     ├── 无 lastRun → 检查当前时间是否匹配
  │     │
  │     └── 有 lastRun → 计算上次执行后应该执行的第一个时间
  │           │
  │           └── 如果该时间 <= 当前时间 → 触发执行
  │
  ├── 触发时：
  │     ├── 创建任务副本，添加到 queue.json
  │     ├── 设置 scheduled: true, scheduledId: 原任务ID
  │     └── 更新 lastRun 为当前时间
  │
  └── 始终更新 nextRun 字段
```

### 10.4 防止重复执行机制

使用 `lastRun` 记录上次执行时间，通过时间戳比较确保：

```javascript
// 将时间截断到分钟级别进行比较
const lastRunMinute = Math.floor(lastRunDate.getTime() / 60000) * 60000;
const nowMinute = Math.floor(nowDate.getTime() / 60000) * 60000;

if (lastRunMinute !== nowMinute) {
  // 计算是否有错过的执行
  const nextAfterLastRun = cronParser.getNextRunTime(task.cron, lastRunDate);
  const nextAfterLastRunMinute = Math.floor(nextAfterLastRun.getTime() / 60000) * 60000;

  // 如果应该执行的时间 <= 现在（分钟级），说明错过了执行
  if (nextAfterLastRunMinute <= nowMinute && nextAfterLastRunMinute !== lastRunMinute) {
    shouldExecute = true;
  }
}
```

**关键设计决策：分钟级匹配**

由于轮询间隔是 10 秒，秒级精确匹配可能被错过。因此 `shouldRunNow()` 只检查分钟及以上的粒度：

```javascript
shouldRunNow(cronExpression, now) {
  // 忽略秒，只检查分钟及以上的时间粒度
  return (
    schedule.minutes.includes(minutes) &&
    schedule.hours.includes(hours) &&
    schedule.days.includes(day) &&
    schedule.months.includes(month) &&
    schedule.weekdays.includes(weekday)
  );
}
```

---

## 11. 任务状态与生命周期

### 11.1 任务状态流转图

```
                    ┌─────────────┐
                    │   创建任务   │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
            ┌──────→│   queue.json │←──────┐
            │       │   (待执行)   │       │
            │       └──────┬──────┘       │
            │              │               │
            │              ▼               │
            │       ┌─────────────┐       │
            │       │running.json │       │
            │       │  (执行中)   │       │
            │       └──────┬──────┘       │
            │              │               │
            │       ┌──────┴──────┐       │
            │       ▼             ▼       │
            │ ┌───────────┐ ┌───────────┐ │
            │ │  成功     │ │  失败     │ │
            │ └─────┬─────┘ └─────┬─────┘ │
            │       │             │       │
            │       ▼             ▼       │
            │ ┌───────────┐ ┌───────────┐ │
            │ │completed  │ │ 重试次数<N │─┘
            │ │  .json    │ │   重试    │
            │ └───────────┘ └─────┬─────┘
            │                     │
            │                     ▼ (重试次数>=N)
            │               ┌───────────┐
            │               │ failed    │
            │               │  .json    │
            │               └───────────┘
            │
            └─ 定时任务到期时自动添加
```

### 11.2 JSON 文件结构详解

#### queue.json（任务队列）

```json
{
  "list": [
    {
      "id": "task-1234567890",
      "prompt": "执行代码审查",
      "workspace": "E:/project",
      "timeout": 600000,
      "autoApprove": true,
      "allowedTools": [],
      "scheduled": false,
      "createdAt": "2026-02-25 10:00:00"
    }
  ]
}
```

#### scheduled.json（定时任务配置）

```json
{
  "tasks": [
    {
      "id": "daily-report",
      "name": "每日报告",
      "cron": "0 9 * * *",
      "prompt": "生成每日报告",
      "workspace": "E:/project",
      "enabled": true,
      "lastRun": "2026-02-25T01:00:00.000Z",
      "nextRun": "2026-02-26 09:00:00"
    }
  ]
}
```

#### running.json（运行中任务）

```json
{
  "id": "task-1234567890",
  "prompt": "执行代码审查",
  "startedAt": "2026-02-25 10:00:00",
  "...": "原有任务字段"
}
```

#### completed.json（已完成）

```json
{
  "list": [
    {
      "id": "task-1234567890",
      "completedAt": "2026-02-25 10:05:00",
      "status": "success"
    }
  ]
}
```

#### failed.json（失败任务）

```json
{
  "list": [
    {
      "id": "task-1234567890",
      "failedAt": "2026-02-25 10:10:00",
      "error": "Task timeout after 600000ms",
      "retries": 3,
      "status": "failed"
    }
  ]
}
```

### 11.3 任务生命周期

#### 即时任务流程

```
1. 用户执行 add-task.js
   │
   ▼
2. 任务添加到 queue.json
   │
   ▼
3. 主循环检测到新任务（10秒内）
   │
   ▼
4. 写入 running.json，设置 isProcessing = true
   │
   ▼
5. spawn Claude Code CLI，通过 stdin 传递 prompt
   │
   ├── 成功 → 移动到 completed.json
   │
   └── 失败 → 重试次数 < 2 ? 放回队列 : 移动到 failed.json
   │
   ▼
6. 从 queue.json 移除，设置 isProcessing = false
```

#### 定时任务流程

```
1. 定时任务配置在 scheduled.json
   │
   ▼
2. 主循环检查是否到期（每 10 秒）
   │
   ▼
3. 到期时创建任务副本：
   {
     id: "{原ID}-{timestamp}",
     scheduled: true,
     scheduledId: "原ID",
     ...其他字段
   }
   │
   ▼
4. 添加到 queue.json，更新 lastRun
   │
   ▼
5. 按即时任务流程执行
```

---

## 12. 错误处理与重试机制

### 12.1 重试策略

```javascript
const CONFIG = {
  maxRetries: 2,  // 最多重试 2 次（共执行 3 次）
};
```

**重试逻辑代码：**

```javascript
catch (err) {
  const retries = (task.retries || 0) + 1;

  if (retries < CONFIG.maxRetries) {
    // 更新重试次数，放回队列（下次轮询时重试）
    task.retries = retries;
    log.info(`任务将在下次轮询时重试 (${retries}/${CONFIG.maxRetries}): ${task.id}`);
  } else {
    // 超过最大重试次数，移动到失败列表
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
```

### 12.2 超时处理

```javascript
async function executeTask(task) {
  const timeout = task.timeout || CONFIG.taskTimeout;

  // 超时定时器
  const timer = setTimeout(() => {
    log.error(`任务超时 (${timeout}ms)，正在终止...`);
    child.kill('SIGTERM');
    reject(new Error(`Task timeout after ${timeout}ms`));
  }, timeout);

  // 进程退出时清理定时器
  child.on('exit', () => {
    clearTimeout(timer);
  });
}
```

### 12.3 进程异常处理

```javascript
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
```

### 12.4 错误码参考

| 错误码 | 说明 | 处理建议 |
|--------|------|---------|
| `Task timeout after Xms` | 任务执行超时 | 增加超时时间或简化任务 |
| `Process killed by signal: SIGTERM` | 进程被终止 | 检查是否有手动停止 |
| `Process exited with code: 1` | Claude CLI 异常退出 | 检查日志了解具体原因 |
| `Invalid cron expression` | Cron 表达式无效 | 修正定时任务配置 |

---

## 13. 已知问题与解决方案

### 13.1 问题：进程中断后状态残留

**现象：** auto-runner.js 进程被终止时，`running.json` 不会被清理，导致下次启动时状态不一致。

**影响：** 无法准确判断上次任务是否完成。

**当前临时方案：** 启动时删除 `running.json`：

```javascript
// 在 main() 函数中
if (fs.existsSync(CONFIG.runningFile)) {
  fs.unlinkSync(CONFIG.runningFile);
}
```

**建议改进：**

```javascript
// 启动时检查 running.json 是否过期
function checkStaleRunningTask() {
  if (fs.existsSync(CONFIG.runningFile)) {
    const running = readJsonFile(CONFIG.runningFile);
    const startedAt = parseTaskTime(running.startedAt);
    const elapsed = Date.now() - startedAt.getTime();

    // 如果运行时间超过 2 倍超时时间，视为残留
    if (elapsed > running.timeout * 2) {
      log.warn('发现残留的运行任务，正在清理...');
      // 可选：将残留任务移动到 failed.json
      const failed = readJsonFile(CONFIG.failedFile);
      failed.list.push({
        ...running,
        failedAt: toLocalTimeString(),
        error: 'Process interrupted (stale running state)',
        status: 'failed'
      });
      writeJsonFile(CONFIG.failedFile, failed);
      fs.unlinkSync(CONFIG.runningFile);
    } else {
      log.info('检测到可能正在运行的任务，等待...');
    }
  }
}
```

### 13.2 问题：isProcessing 变量丢失

**现象：** 进程重启后，`isProcessing` 内存变量重置为 false，可能导致重复执行。

**建议改进：** 使用 `running.json` 文件替代内存变量：

```javascript
// 替代原来的 isProcessing 变量
function isCurrentlyProcessing() {
  return fs.existsSync(CONFIG.runningFile);
}

// 在主循环中使用
if (!isCurrentlyProcessing() && queue.list.length > 0) {
  // 执行任务...
}
```

### 13.3 问题：定时任务跨天/长时间停机

**现象：** 如果服务停机超过定时任务的触发时间，可能会错过执行。

**建议改进：** 记录错过的执行次数，支持补执行：

```javascript
// 在 scheduled.json 中添加字段
{
  "id": "daily-report",
  "cron": "0 9 * * *",
  "catchUp": true,  // 是否补执行错过的任务
  "maxCatchUp": 3,  // 最多补执行次数
  ...
}
```

### 13.4 问题：队列处理卡住

**现象：** 当 `running.json` 存在但进程已停止时，队列中的任务不会被执行。

**诊断方法：**

```bash
# 检查是否有 running.json
ls tasks/running.json

# 检查 auto-runner 进程是否运行
pm2 status
# 或
wmic process where "commandline like '%auto-runner%'" get commandline,processid
```

**解决方案：**

```bash
# 1. 确认 auto-runner 正在运行
pm2 restart claude-runner

# 2. 如果确定没有任务在执行，清理残留文件
del tasks\running.json
```

---

## 14. 扩展功能建议

### 14.1 任务优先级

```javascript
// 任务结构扩展
{
  "id": "task-xxx",
  "priority": 0,  // 0=普通, 1=高优先级, 2=紧急
  ...
}

// 队列排序逻辑
queue.list.sort((a, b) => {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;  // 高优先级优先
  }
  return new Date(a.createdAt) - new Date(b.createdAt);  // 同优先级按时间
});
```

### 14.2 任务依赖

```javascript
// 任务结构扩展
{
  "id": "task-xxx",
  "dependsOn": ["task-yyy"],  // 依赖的任务ID列表
  ...
}

// 执行前检查依赖
function canExecute(task, completedTasks) {
  if (!task.dependsOn || task.dependsOn.length === 0) {
    return true;
  }
  return task.dependsOn.every(depId =>
    completedTasks.some(c => c.id === depId)
  );
}
```

### 14.3 并发执行

当前是串行执行，可支持有限并发：

```javascript
const CONFIG = {
  maxConcurrent: 3,  // 最多同时执行 3 个任务
};

// 使用 Promise.all 或队列池
const activeTasks = new Set();

async function processQueue() {
  const queue = readJsonFile(CONFIG.taskFile);

  while (activeTasks.size < CONFIG.maxConcurrent && queue.list.length > 0) {
    const task = queue.list.shift();
    activeTasks.add(task.id);

    executeTask(task).finally(() => {
      activeTasks.delete(task.id);
    });
  }
}
```

### 14.4 任务模板

```javascript
// templates.json
{
  "code-review": {
    "prompt": "执行代码审查，检查以下内容：安全性、性能、可维护性",
    "timeout": 300000,
    "allowedTools": ["Read", "Grep", "Glob"]
  },
  "daily-report": {
    "prompt": "生成每日工作报告，包括：完成的任务、遇到的问题、明天的计划",
    "timeout": 180000
  }
}

// 使用模板添加任务
// node add-task.js --template code-review
```

### 14.5 Webhook 通知

```javascript
// 任务结构扩展
{
  "id": "task-xxx",
  "webhook": {
    "onSuccess": "https://api.example.com/success",
    "onFailure": "https://api.example.com/failure"
  }
}

// 执行完成后发送通知
async function sendWebhook(task, status, error = null) {
  const url = status === 'success' ? task.webhook?.onSuccess : task.webhook?.onFailure;
  if (!url) return;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: task.id,
        status,
        error,
        completedAt: new Date().toISOString()
      })
    });
  } catch (err) {
    log.error(`Webhook 发送失败: ${err.message}`);
  }
}
```

---

## 15. 快速参考

### 15.1 Cron 表达式速查表

| 表达式 | 说明 |
|--------|------|
| `* * * * *` | 每分钟 |
| `*/5 * * * *` | 每 5 分钟 |
| `*/20 * * * *` | 每 20 分钟 |
| `0 * * * *` | 每小时整点 |
| `0 9 * * *` | 每天 9:00 |
| `0 9,12,18 * * *` | 每天 9:00, 12:00, 18:00 |
| `0 9 * * 1-5` | 周一到周五 9:00 |
| `0 0 1 * *` | 每月 1 日 0:00 |
| `0 12 * * 0` | 每周日 12:00 |

### 15.2 常用命令速查

```bash
# PM2 管理
pm2 start ecosystem.config.js    # 启动服务
pm2 status                       # 查看状态
pm2 logs claude-runner           # 查看日志
pm2 restart claude-runner        # 重启服务
pm2 stop claude-runner           # 停止服务
pm2 save                         # 保存状态

# 任务管理
node src/add-task.js "任务描述"  # 添加任务
node src/add-task.js "..." -w /path  # 指定工作目录
node src/add-task.js "..." -t 300000 # 设置超时
node src/add-task.js "..." -y    # 自动批准

# 故障排查
type tasks\queue.json            # 查看队列
type tasks\running.json          # 查看运行中任务
del tasks\running.json           # 清理残留状态
```

### 15.3 配置参数速查

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `pollInterval` | 10000ms | 轮询间隔 |
| `maxRetries` | 2 | 最大重试次数 |
| `taskTimeout` | 600000ms | 单任务超时 |
| `max_memory_restart` | 1000M | 内存限制 |
| `cron_restart` | 0 12 * * * | 定时重启时间 |