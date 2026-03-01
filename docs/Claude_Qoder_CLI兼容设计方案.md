# 多CLI工具兼容与扩展设计方案

## 1. 设计背景

当前项目基于PM2构建的24/7自动化任务执行系统，主要用于持续运行Claude Code并自动处理预设任务。随着Qoder CLI的引入以及未来可能集成的其他AI/自动化CLI工具，需要在保持现有功能不变的前提下，构建一个可扩展的多CLI工具支持架构。

## 2. 设计目标

- **向后兼容**：确保所有现有的Claude任务继续正常工作
- **可扩展性**：支持任意数量的CLI工具集成，无需修改核心代码
- **统一接口**：通过相同的任务队列管理所有类型的CLI任务
- **参数映射**：自动处理不同CLI工具的参数差异
- **插件化设计**：每个CLI工具作为独立插件，便于维护和扩展
- **配置驱动**：通过配置文件定义CLI工具行为，降低代码耦合

## 3. 系统架构

### 3.1 整体架构
```
PM2 → auto-runner.js（轮询器）→ 读取 tasks/queue.json → 
    ├─ CLI插件管理器
    │   ├─ Claude CLI插件（cliType: "claude"）
    │   ├─ Qoder CLI插件（cliType: "qoder"）
    │   └─ 其他CLI插件（cliType: "custom"）
    └─ 执行结果 → 归档至 completed/failed
```

### 3.2 数据流
1. 用户通过 `add-task.js` 或批处理脚本添加任务，指定 `cliType`
2. 任务信息保存到 `tasks/queue.json`，包含 `cliType` 标识
3. `auto-runner.js` 轮询任务队列，根据 `cliType` 字段选择对应的CLI插件
4. CLI插件管理器加载对应插件并执行任务
5. 执行完成后，任务状态更新并移动到相应的结果文件

## 4. 核心设计

### 4.1 任务数据结构

任务对象字段更新：
```json
{
  "id": "task-12345",
  "prompt": "任务描述",
  "workspace": "D:\\project",
  "autoApprove": true,
  "allowedTools": ["READ", "WRITE"],
  "timeout": 600000,
  "createdAt": "2026-02-28 16:03:27",
  "cliType": "qoder"  // 替换useQoder，支持多种CLI类型
}
```

**字段说明**：
- `cliType` (string, 可选): 指定使用的CLI工具类型
  - `"claude"`: 使用Claude CLI（默认值，向后兼容）
  - `"qoder"`: 使用Qoder CLI
  - 其他自定义值: 对应自定义CLI插件

### 4.2 CLI插件配置

新增配置文件 `src/config/cli-config.json`：
```json
{
  "defaultCliType": "claude",
  "cliTypes": {
    "claude": {
      "command": "claude",
      "description": "Claude AI CLI",
      "parameters": {
        "prompt": { "method": "stdin", "required": true },
        "workspace": { "method": "cwd", "required": false },
        "autoApprove": { "flag": "--dangerously-skip-permissions", "required": false },
        "allowedTools": { "flag": "--allowedTools", "join": ",", "required": false }
      },
      "supports": ["prompt", "workspace", "autoApprove", "allowedTools"]
    },
    "qoder": {
      "command": "qodercli",
      "description": "Qoder CLI",
      "parameters": {
        "prompt": { "flag": "-p", "required": true },
        "workspace": { "flag": "-w", "required": false },
        "autoApprove": { "flag": "--yolo", "required": false },
        "allowedTools": { "flag": "--allowed-tools", "join": ",", "required": false }
      },
      "supports": ["prompt", "workspace", "autoApprove", "allowedTools", "quiet"],
      "defaultFlags": ["-q"]
    }
  }
}
```

### 4.3 插件化执行逻辑

```javascript
// CLI插件管理器
class CliPluginManager {
  constructor(configPath = './src/config/cli-config.json') {
    this.config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    this.defaultCliType = this.config.defaultCliType;
  }

  getPlugin(cliType) {
    const typeConfig = this.config.cliTypes[cliType];
    if (!typeConfig) {
      throw new Error(`Unsupported CLI type: ${cliType}`);
    }
    return new CliPlugin(typeConfig);
  }

  getDefaultCliType() {
    return this.defaultCliType;
  }
}

// CLI插件基类
class CliPlugin {
  constructor(config) {
    this.config = config;
    this.command = config.command;
    this.parameters = config.parameters;
    this.supports = config.supports || [];
    this.defaultFlags = config.defaultFlags || [];
  }

  buildCommand(task) {
    const args = [...this.defaultFlags];
    const stdinInput = null;
    
    for (const [paramName, paramConfig] of Object.entries(this.parameters)) {
      if (task[paramName] !== undefined && task[paramName] !== null) {
        if (paramConfig.method === 'stdin') {
          // stdin方式处理
          stdinInput = task[paramName];
        } else if (paramConfig.flag) {
          // flag方式处理
          args.push(paramConfig.flag);
          if (paramConfig.join) {
            args.push(task[paramName].join(paramConfig.join));
          } else if (typeof task[paramName] === 'boolean') {
            if (task[paramName]) {
              // boolean参数，只在true时添加flag
            } else {
              continue;
            }
          } else {
            args.push(task[paramName]);
          }
        }
      }
    }
    
    return { command: this.command, args, stdinInput };
  }
}

// 执行逻辑
async function executeTask(task) {
  const cliType = task.cliType || cliPluginManager.getDefaultCliType();
  const plugin = cliPluginManager.getPlugin(cliType);
  const { command, args, stdinInput } = plugin.buildCommand(task);
  
  // 执行命令...
}
```

## 5. 文件修改清单

### 5.1 新增文件
- `src/config/cli-config.json`: CLI工具配置文件
- `src/lib/cli-plugin-manager.js`: CLI插件管理器实现
- `src/lib/cli-plugin.js`: CLI插件基类实现

### 5.2 src/add-task.js
- 将 `--qoder` / `-q` 参数改为 `--cli-type` / `-t` 参数
- 支持任意CLI类型指定
- 默认使用配置文件中的默认CLI类型
- 更新帮助信息和使用示例

### 5.3 src/auto-runner.js
- 集成CLI插件管理器
- 根据 `cliType` 字段动态选择执行插件
- 实现通用的参数构建和执行逻辑
- 添加插件加载错误处理

### 5.4 scripts/add-task.bat
- 在帮助信息中添加 `--cli-type` 选项说明
- 更新使用示例，展示多CLI类型用法

### 5.5 JSON文件处理
- 任务队列文件 (`tasks/queue.json`) 使用 `cliType` 字段
- 其他状态文件同样保留该字段
- 保持向后兼容：未指定 `cliType` 的任务默认使用Claude

## 6. 使用方式

### 6.1 添加Claude任务（默认）
```bash
# JavaScript方式
node src/add-task.js "检查代码中的TODO注释"

# 批处理方式  
scripts\add-task.bat "检查代码中的TODO注释"
```

### 6.2 添加Qoder任务
```bash
# JavaScript方式
node src/add-task.js "执行任务" --cli-type qoder -w "e:\" --auto-approve

# 批处理方式
scripts\add-task.bat "执行任务" --cli-type qoder -w "e:\" --auto-approve
```

### 6.3 添加自定义CLI任务
```bash
# JavaScript方式
node src/add-task.js "自定义任务" --cli-type mytool --custom-param value

# 需要在cli-config.json中预先配置mytool
```

### 6.4 混合任务队列
同一个任务队列可以同时包含多种CLI工具的任务，系统会自动识别并正确执行。

## 7. 兼容性保证

### 7.1 向后兼容
- 不指定 `cliType` 时，行为与修改前完全一致（默认Claude）
- 所有现有脚本、定时任务无需任何修改
- 任务队列格式向后兼容（`cliType` 字段为可选）

### 7.2 错误处理
- 如果指定的CLI类型未在配置中定义，任务会失败并记录详细错误
- 如果系统未安装对应CLI工具，执行时会报错并记录到失败日志
- 任务重试机制对所有CLI类型都适用
- 日志中明确标识使用的CLI类型和完整命令，便于问题排查

## 8. 扩展指南

### 8.1 添加新CLI工具步骤
1. 在 `src/config/cli-config.json` 中添加新的CLI类型配置
2. 确保系统已安装对应的CLI工具
3. 测试任务执行是否正常

### 8.2 CLI配置参数说明
- `command`: CLI工具的可执行命令名称
- `parameters`: 参数映射配置
  - `method`: "stdin" 表示通过标准输入传递，"flag" 表示通过命令行参数
  - `flag`: 命令行参数标志
  - `join`: 数组参数的连接符
  - `required`: 是否必需
- `supports`: 该CLI支持的功能列表
- `defaultFlags`: 默认添加的命令行参数

### 8.3 高级配置选项
- 支持环境变量配置
- 支持版本检测和兼容性检查
- 支持自定义验证逻辑
- 支持异步参数处理

## 9. 测试验证

### 9.1 功能测试
- [ ] Claude任务正常添加和执行
- [ ] Qoder任务正常添加和执行  
- [ ] 混合任务队列正确处理
- [ ] 参数映射正确（autoApprove、workspace等）
- [ ] 新CLI工具配置和执行
- [ ] 插件管理器错误处理

### 9.2 兼容性测试
- [ ] 现有任务队列文件能被正确读取
- [ ] 不包含cliType字段的任务默认使用Claude CLI
- [ ] PM2进程管理正常工作
- [ ] 配置文件热更新支持（可选）

### 9.3 扩展性测试
- [ ] 动态添加新CLI配置无需重启服务
- [ ] 配置文件格式验证
- [ ] 性能影响评估

## 10. 部署说明

### 10.1 环境要求
- Node.js v18+
- PM2 最新版
- Claude CLI（已登录并可用）
- Qoder CLI（可选）
- 其他CLI工具（按需安装）

### 10.2 启动方式
```bash
# 推荐方式
scripts\start-pm2.bat

# 或直接使用PM2
pm2 start ecosystem.config.js
pm2 save
```

### 10.3 监控日志
- 查看日志：`pm2 logs claude-runner`
- 任务状态：检查 `tasks/` 目录下的JSON文件
- 执行详情：日志中会显示使用的CLI类型和完整命令
- 配置文件：`src/config/cli-config.json`

## 11. 未来扩展

### 11.1 进一步改进方向
- **Web管理界面**：提供CLI配置的可视化管理
- **插件市场**：支持社区贡献的CLI插件
- **动态插件加载**：运行时加载新插件，无需重启
- **性能监控**：各CLI工具的执行性能统计
- **安全沙箱**：为不同CLI工具提供隔离的执行环境

### 11.2 配置优化
- **YAML支持**：提供YAML格式的配置文件选项
- **环境变量覆盖**：支持通过环境变量覆盖配置
- **远程配置**：支持从远程服务器获取CLI配置
- **版本管理**：CLI配置的版本控制和回滚

### 11.3 企业级特性
- **权限控制**：不同用户/角色可使用的CLI工具限制
- **审计日志**：详细的CLI执行审计跟踪
- **资源配额**：各CLI工具的资源使用限制
- **高可用部署**：多节点任务分发和负载均衡

---
*文档版本：2.0*  
*最后更新：2026-03-01*