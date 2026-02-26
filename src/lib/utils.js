/**
 * 共享工具函数模块
 */

/**
 * 将 Date 对象转换为本地时间字符串
 * @param {Date|string|number} date - Date 对象、时间字符串或时间戳
 * @returns {string} 格式为 "YYYY-MM-DD HH:mm:ss"
 */
function toLocalTimeString(date = new Date()) {
  const d = typeof date === 'number' || typeof date === 'string'
    ? new Date(date)
    : date;
  // 补零函数
  const pad = (n) => n.toString().padStart(2, '0');
  // 直接使用本地时间组件构建字符串
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 日志工具
 */
const log = {
  info: (msg) => console.log(`[${toLocalTimeString()}] [INFO] ${msg}`),
  error: (msg) => console.error(`[${toLocalTimeString()}] [ERROR] ${msg}`),
  success: (msg) => console.log(`[${toLocalTimeString()}] [SUCCESS] ${msg}`),
};

module.exports = {
  toLocalTimeString,
  log,
};
