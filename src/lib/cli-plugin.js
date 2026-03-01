const fs = require('fs');

/**
 * CLI插件基类
 * 负责根据配置构建命令行参数并执行CLI工具
 */
class CliPlugin {
  constructor(config) {
    this.config = config;
    this.command = config.command;
    this.parameters = config.parameters || {};
    this.supports = config.supports || [];
    this.defaultFlags = config.defaultFlags || [];
  }

  /**
   * 构建命令行参数
   * @param {Object} task - 任务对象
   * @returns {Object} 包含command、args和stdinInput的对象
   */
  buildCommand(task) {
    const args = [...this.defaultFlags];
    let stdinInput = null;
    
    // 遍历所有支持的参数
    for (const [paramName, paramConfig] of Object.entries(this.parameters)) {
      if (task[paramName] !== undefined && task[paramName] !== null) {
        if (paramConfig.method === 'stdin') {
          // 通过标准输入传递参数
          stdinInput = task[paramName];
        } else if (paramConfig.flag) {
          // 通过命令行参数传递
          if (typeof task[paramName] === 'boolean') {
            // 布尔参数：只有true时才添加flag
            if (task[paramName]) {
              args.push(paramConfig.flag);
            }
          } else if (Array.isArray(task[paramName])) {
            // 数组参数：使用join连接符
            if (paramConfig.join !== undefined) {
              args.push(paramConfig.flag);
              args.push(task[paramName].join(paramConfig.join));
            } else {
              // 如果没有指定join，每个元素单独作为参数
              args.push(paramConfig.flag);
              args.push(...task[paramName]);
            }
          } else {
            // 普通参数
            args.push(paramConfig.flag);
            args.push(task[paramName]);
          }
        }
      }
    }
    
    return { 
      command: this.command, 
      args, 
      stdinInput,
      cwd: task.workspace || process.cwd()
    };
  }

  /**
   * 检查是否支持特定功能
   * @param {string} feature - 功能名称
   * @returns {boolean} 是否支持
   */
  supportsFeature(feature) {
    return this.supports.includes(feature);
  }
}

module.exports = CliPlugin;