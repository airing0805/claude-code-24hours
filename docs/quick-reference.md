# Claude Code 24h 系统 - 快速参考手册

## 🚀 常用命令

### 系统启动
```bash
# 初始化任务系统
node scripts/init-tasks.js

# 启动服务（推荐）
scripts/start-pm2.bat

# 或使用PM2直接启动
pm2 start ecosystem.config.js
pm2 save  # 保存配置
```

### 添加任务
```bash
# Windows批处理（推荐）
scripts/add-task.bat "任务描述"

# 命令行方式
node src/add-task.js "任务描述" -w 工作目录 -t 超时时间 -y

# 参数说明
-w: 工作目录（默认当前目录）
-t: 超时毫秒（默认600000=10分钟）
-y: 自动批准（跳过权限确认）
```

### 状态查看
```bash
pm2 status              # 进程状态
pm2 logs claude-runner  # 实时日志
pm2 monit               # 监控仪表板
type tasks\queue.json   # 查看任务队列（Windows）
cat tasks/queue.json    # 查看任务队列（Linux/Mac）
```

### 服务控制
```bash
pm2 restart claude-runner  # 重启
pm2 stop claude-runner     # 停止
pm2 start claude-runner    # 启动
pm2 delete claude-runner   # 删除
pm2 reload claude-runner   # 零停机重载
```

## 📄 JSON 格式说明

### 任务队列文件 (tasks/queue.json)
```json
{
  "list": [
    {
      "id": "task-时间戳",
      "prompt": "任务描述",
      "workspace": "工作目录路径",
      "timeout": 600000,
      "autoApprove": false,
      "allowedTools": ["Read", "Grep"],
      "createdAt": "ISO8601时间"
    }
  ]
}
```

### 必填字段
- `id`: 任务唯一标识（建议格式：`task-{timestamp}`）
- `prompt`: Claude Code 任务指令

### 可选字段
- `workspace`: 执行目录（默认项目根目录）
- `timeout`: 超时时间（毫秒，默认600000）
- `autoApprove`: 自动批准（布尔值，默认false）
- `allowedTools`: 允许工具列表（数组，null表示不限制）
- `createdAt`: 创建时间（ISO 8601格式）

### 定时任务 (tasks/scheduled.json)
```json
{
  "tasks": [
    {
      "id": "定时任务ID",
      "name": "任务名称",
      "cron": "0 9 * * *",
      "prompt": "任务描述",
      "enabled": true
    }
  ]
}
```

### Cron 表达式示例
- `0 9 * * *` : 每天9点
- `0 17 * * 5` : 每周五17点  
- `*/30 * * * *` : 每30分钟
- `0 */2 * * *` : 每2小时

## ⚡ 故障处理
```bash
# 任务卡住
del tasks\running.json && pm2 restart claude-runner

# 紧急恢复
pm2 resurrect

# 清空日志
pm2 flush
```