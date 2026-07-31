import path from "node:path"
import { fileURLToPath } from "node:url"
import plugin from "../../lib/plugins/plugin.js"
import PluginsLoader from "../../lib/plugins/loader.js"
import { createRuntime } from "./src/runtime/createRuntime.js"

const pluginRoot = path.dirname(fileURLToPath(import.meta.url))
let runtime

function getRuntime() {
  runtime ??= createRuntime({
    pluginRoot,
    pluginLoader: PluginsLoader,
    redis: globalThis.redis,
    segment: globalThis.segment,
    Bot: globalThis.Bot,
    baseLogger: globalThis.logger,
  })
  return runtime
}

export class AiEnhanceControl extends plugin {
  constructor() {
    super({
      name: "aiEnhance-plugin 管理",
      dsc: "AI 对话与自然语言命令路由管理",
      event: "message",
      priority: 10,
      rule: [
        {
          reg: "^#[Aa][Ii]帮助$",
          fnc: "help",
        },
        {
          reg: "^#[Aa][Ii]清空会话$",
          fnc: "clearMemory",
        },
        {
          reg: "^#[Aa][Ii]状态$",
          fnc: "status",
          permission: "master",
        },
        {
          reg: "^#[Aa][Ii]重载$",
          fnc: "reload",
          permission: "master",
        },
      ],
    })
  }

  help() {
    return this.reply(
      [
        "aiEnhance-plugin 使用说明",
        "• 群聊：@机器人 后直接说需求",
        "• 私聊：直接对话或描述想查询的内容",
        "• 图片：发送图片并询问其中的内容（模型需支持视觉）",
        "• 攻略问答：直接问“纳西妲带什么圣遗物”等具体养成问题",
        "• #AI清空会话",
        "• #AI状态（主人）",
        "• #AI重载（主人）",
        "",
        "登录、Token、删除、更新等敏感操作不会由 AI 自动执行。",
      ].join("\n"),
      true,
    )
  }

  async clearMemory() {
    await getRuntime().service.clearMemory(this.e)
    return this.reply("已清空当前会话记录。", true)
  }

  async status() {
    const status = await getRuntime().status()
    const errors = status.errors.length ? status.errors.join("；") : "无"
    return this.reply(
      [
        "aiEnhance-plugin 状态",
        `启用：${status.enabled ? "是" : "否"}`,
        `API：${status.baseUrl}${status.endpoint}`,
        `模型：${status.model}`,
        `API Key：${status.hasApiKey ? "已设置" : "未设置"}`,
        `结构化输出：${status.responseFormat}`,
        `图片识别：${status.visionEnabled ? `开启（最多 ${status.visionMaxImages} 张）` : "关闭"}`,
        `攻略问答：${status.knowledgeEnabled ? `开启（攻略识图${status.knowledgeGuideVisionEnabled ? "开启" : "关闭"}）` : "关闭"}`,
        `模型联网：${status.webSearchEnabled ? "开启（Responses web_search）" : "关闭"}`,
        `候选命令：${status.candidateCount}`,
        `自动执行：${status.autoExecuteEnabled ? "开启" : "关闭"}`,
        `阈值：执行 ${status.autoExecuteConfidence} / 确认 ${status.confirmConfidence}`,
        `会话 TTL：${status.memoryTtlSeconds} 秒`,
        `配置问题：${errors}`,
      ].join("\n"),
      true,
    )
  }

  async reload() {
    await getRuntime().reload()
    return this.reply("aiEnhance-plugin 配置与命令目录已重载。", true)
  }
}

export class AiEnhanceEntry extends plugin {
  constructor() {
    super({
      name: "aiEnhance-plugin 兜底",
      dsc: "未命中消息的 AI 对话与安全命令路由",
      event: "message",
      // Yunzai 的数字越小优先级越高；兜底必须位于业务插件之后。
      priority: 999_999_999,
      rule: [
        {
          reg: "^[\\s\\S]*$",
          fnc: "handle",
          log: false,
        },
      ],
    })
  }

  async handle() {
    return getRuntime().service.handle(this.e)
  }
}
