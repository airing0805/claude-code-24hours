const fs = require('fs');
const path = require('path');
const CliPlugin = require('./cli-plugin');

/**
 * CLI插件管理器
 * 负责加载CLI配置并管理不同CLI工具的插件实例
 */
class CliPluginManager {
  constructor(configPath = null) {
    // 如果没有指定配置路径，使用默认路径
    this.configPath = configPath || path.join(__dirname, '..', 'config', 'cli-config.json');
    this.loadConfig();
  }

  /**
   * 加载配置文件
   */
  loadConfig() {
    try {
      const configContent = fs.readFileSync(this.configPath, 'utf8');
      this.config = JSON.parse(configContent);
      this.defaultCliType = this.config.defaultCliType || 'claude';
      this.cliTypes = this.config.cliTypes || {};
    } catch (error) {
      console.error(`Failed to load CLI configuration from ${this.configPath}:`, error);
      throw new Error(`CLI configuration loading failed: ${error.message}`);
    }
  }

  /**
   * 获取指定CLI类型的插件实例
   * @param {string} cliType - CLI类型名称
   * @returns {CliPlugin} CLI插件实例
   * @throws {Error} 当CLI类型不支持时抛出错误
   */
  getPlugin(cliType) {
    const typeConfig = this.cliTypes[cliType];
    if (!typeConfig) {
      const availableTypes = Object.keys(this.cliTypes).join(', ');
      throw new Error(`Unsupported CLI type: ${cliType}. Available types: ${availableTypes}`);
    }
    return new CliPlugin(typeConfig);
  }

  /**
   * 获取默认CLI类型
   * @returns {string} 默认CLI类型
   */
  getDefaultCliType() {
    return this.defaultCliType;
  }

  /**
   * 检查是否支持指定的CLI类型
   * @param {string} cliType - CLI类型名称
   * @returns {boolean} 是否支持
   */
  supportsCliType(cliType) {
    return cliType in this.cliTypes;
  }

  /**
   * 获取所有支持的CLI类型列表
   * @returns {string[]} CLI类型名称数组
   */
  getSupportedCliTypes() {
    return Object.keys(this.cliTypes);
  }
}

module.exports = CliPluginManager;