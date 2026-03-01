module.exports = {
  apps: [{
    name: 'claude-runner',
    script: './src/auto-runner.js',
    cwd: '.',
    interpreter: 'node',

    // 进程管理
    autorestart: true,
    max_restarts: 30,
    restart_delay: 10000,
    watch: false,

    // 内存限制（超过自动重启）
    max_memory_restart: '1000M',

    // 日志配置
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    out_file: './logs/runner-out.log',
    error_file: './logs/runner-error.log',
    
    // 日志轮转配置 - 控制日志长度
    log_type: 'json', // 可选：'json' 或 'raw'
    log_max_size: '1M', // 单个日志文件最大10MB
    max_logs: 5, // 最多保留5个日志文件

    // 环境变量
    env: {
      NODE_ENV: 'production'
    },

    // 定时重启（可选，每天中午12点重启清理内存）
    cron_restart: '0 12 * * *'
  }]
}