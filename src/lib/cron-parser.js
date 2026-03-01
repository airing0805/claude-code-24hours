/**
 * 简单的 Cron 表达式解析器
 * 支持: 秒 分 时 日 月 周
 * 示例: "0 9 * * *" (每天上午9点), "0 17 * * 5" (每周五下午5点)
 */
class CronParser {
  constructor() {
    this.timeZoneOffset = new Date().getTimezoneOffset() * 60000;
  }

  /**
   * 解析 cron 表达式为数组: [秒, 分, 时, 日, 月, 周]
   */
  parse(cronExpression) {
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length < 5 || parts.length > 6) {
      throw new Error(`无效的 cron 表达式: ${cronExpression}`);
    }

    // 支持 5 位或 6 位格式，6 位格式第一位是秒
    const [seconds, minutes, hours, days, months, weekdays] = parts.length === 6
      ? parts
      : ['0', ...parts];

    return {
      seconds: this.parseField(seconds, 0, 59),
      minutes: this.parseField(minutes, 0, 59),
      hours: this.parseField(hours, 0, 23),
      days: this.parseField(days, 1, 31),
      months: this.parseField(months, 1, 12),
      weekdays: this.parseField(weekdays, 0, 6)
    };
  }

  /**
   * 解析 cron 字段 (支持 *, 数字, 数字-数字, 数字除以步长, 星号除以步长)
   */
  parseField(field, min, max) {
    const values = new Set();

    for (const part of field.split(',')) {
      if (part === '*') {
        for (let i = min; i <= max; i++) values.add(i);
      } else if (part.includes('/')) {
        const [base, step] = part.split('/');
        const baseValues = base === '*' ? range(min, max) : this.parseRange(base, min, max);
        const stepNum = parseInt(step);
        for (let i = 0; i < baseValues.length; i += stepNum) {
          values.add(baseValues[i]);
        }
      } else if (part.includes('-')) {
        for (const v of this.parseRange(part, min, max)) {
          values.add(v);
        }
      } else {
        const num = parseInt(part);
        if (num < min || num > max) {
          throw new Error(`值 ${num} 超出范围 [${min}, ${max}]`);
        }
        values.add(num);
      }
    }

    return Array.from(values).sort((a, b) => a - b);
  }

  parseRange(range, min, max) {
    const [start, end] = range.split('-').map(Number);
    if (start < min || end > max || start > end) {
      throw new Error(`范围 ${range} 无效`);
    }
    const result = [];
    for (let i = start; i <= end; i++) result.push(i);
    return result;
  }

  /**
   * 计算下一次执行时间
   */
  getNextRunTime(cronExpression, fromDate = new Date()) {
    const schedule = this.parse(cronExpression);
    const date = new Date(fromDate);

    // 至少向前推 1 秒，避免立即触发
    date.setSeconds(date.getSeconds() + 1);

    // 最多向前推 4 年
    const maxIterations = 4 * 365 * 24 * 60 * 60;

    for (let i = 0; i < maxIterations; i++) {
      const seconds = date.getSeconds();
      const minutes = date.getMinutes();
      const hours = date.getHours();
      const day = date.getDate();
      const month = date.getMonth() + 1;
      const weekday = date.getDay();

      if (
        schedule.seconds.includes(seconds) &&
        schedule.minutes.includes(minutes) &&
        schedule.hours.includes(hours) &&
        schedule.days.includes(day) &&
        schedule.months.includes(month) &&
        schedule.weekdays.includes(weekday)
      ) {
        return new Date(date);
      }

      // 推进到下一秒
      date.setSeconds(date.getSeconds() + 1);
    }

    throw new Error(`无法计算下一次执行时间: ${cronExpression}`);
  }

  /**
   * 检查是否应该在当前时间执行
   * 注意：这是分钟级检查，因为轮询间隔是 10 秒，秒级匹配容易错过
   */
  shouldRunNow(cronExpression, now = new Date()) {
    const schedule = this.parse(cronExpression);
    const minutes = now.getMinutes();
    const hours = now.getHours();
    const day = now.getDate();
    const month = now.getMonth() + 1;
    const weekday = now.getDay();

    // 忽略秒，只检查分钟及以上的时间粒度
    // 这样即使轮询错过 0 秒时刻，也能在当前分钟内触发
    return (
      schedule.minutes.includes(minutes) &&
      schedule.hours.includes(hours) &&
      schedule.days.includes(day) &&
      schedule.months.includes(month) &&
      schedule.weekdays.includes(weekday)
    );
  }

  /**
   * 验证 cron 表达式是否有效
   */
  isValid(cronExpression) {
    try {
      this.parse(cronExpression);
      this.getNextRunTime(cronExpression);
      return true;
    } catch (e) {
      return false;
    }
  }
}

// 辅助函数
function range(min, max) {
  const result = [];
  for (let i = min; i <= max; i++) result.push(i);
  return result;
}

module.exports = { CronParser, range };