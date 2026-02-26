# Claude Code 24小时自动化任务系统

这是一个基于 PM2 的 24/7 自动化任务执行系统，可以让 Claude Code 持续运行并执行预设任务。

## 项目简介

系统通过 PM2 进程管理器保持 Claude Code 24小时不间断运行，从任务队列中读取任务并自动执行。适合自动化代码检查、文档更新、测试运行等重复性任务。

---

## 环境要求

| 依赖 | 版本要求 | 安装命令 |
|------|---------|---------|
| Node.js | v18+ | https://nodejs.org |
| PM2 | 最新版 | `npm install -g pm2` |
| Claude CLI | 已配置并可用 | - |

---

## 快速开始

### 1. 启动服务

**Windows 用户（推荐）：**

```bash
# 使用启动脚本（先进入项目目录）
cd claude-code-24h-integration
scripts\start-pm2.bat
```

**或使用 PM2 命令：**

```bash
# 先进入项目目录
cd claude-code-24h-integration
pm2 start ecosystem.config.js
pm2 save
```

### 2. 查看运行状态

```bash
pm2 status
pm2 logs claude-runner
```

---

## 任务管理

### 添加任务

**方式一：Windows 批处理脚本（最简单）**

```bash
# 交互式输入
scripts\add-task.bat

# 直接指定任务
scripts\add-task.bat "检查代码中的TODO注释"

# 指定工作目录
scripts\add-task.bat "运行测试" -w "../myproject"
```

**方式二：Node.js 命令行**

```bash
# 基础用法
node src/add-task.js "你的任务描述"

# 指定工作目录
node src/add-task.js "任务描述" --workspace /path/to/project

# 设置超时（毫秒）
node src/add-task.js "任务描述" --timeout 600000

# 自动批准（跳过确认）
node src/add-task.js "任务描述" --auto-approve

# 限制可用工具
node src/add-task.js "任务描述" --tools Read,Write,Bash
```

**方式三：直接编辑队列文件**

编辑 [`tasks/queue.json`](tasks/queue.json)：

```json
{
  "list": [
    {
      "id": "task-001",
      "name": "任务名称",
      "prompt": "你的任务描述",
      "workspace": "../your-project",
      "timeout": 600000,
      "autoApprove": true,
      "allowedTools": null,
      "createdAt": "2026-02-25T00:00:00.000Z"
    }
  ]
}
```

### 任务配置说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 任务唯一标识 |
| `prompt` | 是 | 给 Claude 的任务提示 |
| `workspace` | 否 | 工作目录，默认项目根目录 |
| `timeout` | 否 | 超时时间（毫秒），默认 600000（10分钟） |
| `autoApprove` | 否 | 是否自动批准，默认 false |
| `allowedTools` | 否 | 允许使用的工具列表 |

---

## 运维命令

### PM2 进程管理

```bash
# 启动服务
pm2 start ecosystem.config.js

# 重启服务
pm2 restart claude-runner

# 停止服务
pm2 stop claude-runner

# 删除服务
pm2 delete claude-runner

# 查看状态
pm2 status

# 查看日志
pm2 logs claude-runner

# 清空日志
pm2 flush

# 保存状态（开机自启动）
pm2 save
pm2 startup
```

### 任务状态查看

```bash
# 待执行任务
type tasks\queue.json

# 已完成任务
type tasks\completed.json

# 失败任务
type tasks\failed.json

# 当前运行任务
type tasks\running.json
```

---

## 目录结构

```
claude-code-24h-integration/
├── src/
│   ├── auto-runner.js      # 任务调度器核心
│   └── add-task.js         # 任务添加工具
├── scripts/
│   ├── start-pm2.bat       # Windows 启动脚本
│   └── add-task.bat        # Windows 任务添加脚本
│   └── init-tasks.js       # 任务系统初始化
├── tasks/
│   ├── queue.json          # 待执行任务队列
│   ├── completed.json      # 已完成任务记录
│   ├── failed.json         # 失败任务记录
│   └── running.json        # 当前运行任务（临时）
├── logs/                   # 日志文件
├── ecosystem.config.js     # PM2 配置文件
└── README.md              # 本文档
```

---

## 工作流程

```
1. 启动 PM2 服务
   ↓
2. auto-runner.js 开始轮询（每 10 秒）
   ↓
3. 从 tasks/queue.json 获取第一个任务
   ↓
4. 写入 tasks/running.json（标记运行中）
   ↓
5. 执行 Claude Code CLI
   ↓
6. 成功 → 移至 tasks/completed.json
   失败 → 重试（最多 2 次）→ 移至 tasks/failed.json
   ↓
7. 从 queue.json 中删除该任务
   ↓
8. 继续下一个任务
```

---

## 常见问题

### Q: 任务没有执行？

1. 检查 PM2 状态：`pm2 status`
2. 查看日志：`pm2 logs claude-runner`
3. 确认队列有任务：检查 [`tasks/queue.json`](tasks/queue.json)

### Q: 如何清空任务队列？

```bash
echo {"list":[]} > tasks\queue.json
```

### Q: 如何停止当前运行的任务？

```bash
pm2 stop claude-runner
# 或删除运行标记
del tasks\running.json
```

### Q: autoApprove 安全吗？

**不安全**。`autoApprove: true` 会让 Claude 执行操作时不需人工确认，可能导致数据丢失。

**建议：**
- 测试环境可使用
- 生产环境使用手动确认或限制 `allowedTools`

---

## PM2 配置说明

[`ecosystem.config.js`](ecosystem.config.js) 关键配置：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `autorestart` | true | 进程崩溃自动重启 |
| `max_restarts` | 30 | 最大重启次数 |
| `restart_delay` | 10000 | 重启延迟（毫秒） |
| `max_memory_restart` | 1000M | 内存超过 1GB 自动重启 |
| `cron_restart` | '0 12 * * *' | 每天 12:00 定时重启 |

修改轮询间隔：编辑 [`src/auto-runner.js`](src/auto-runner.js#L21) 的 `pollInterval` 值。

---

## 安全建议

1. **限制工具访问**：使用 `allowedTools` 只允许必要的工具
2. **分离环境**：测试和生产使用不同的队列
3. **定期审查**：检查 `completed.json` 了解执行的操作
4. **备份重要数据**：定期备份项目代码
5. **监控资源**：监控 CPU 和内存使用情况

---

## 详细文档

完整的部署、配置和运维指南请参考：
- [`docs/PM2与Claude_Code结合24小时运行落地实践.md`](docs/PM2与Claude_Code结合24小时运行落地实践.md)
