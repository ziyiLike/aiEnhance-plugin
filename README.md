# aiEnhance-plugin

[![License](https://img.shields.io/github/license/ziyiLike/aiEnhance-plugin)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TRSS-Yunzai](https://img.shields.io/badge/TRSS--Yunzai-plugin-4f46e5)](https://github.com/TimeRainStarSky/Yunzai)

为 TRSS-Yunzai 提供 AI 对话和自然语言命令增强：

- 群聊直接 `@机器人`、私聊直接发送消息即可对话；
- 可以随消息发送图片，让支持视觉的模型识别图片内容；
- 原有插件没有处理消息时，分析用户可能想使用的命令；
- 高置信度、只读且在白名单内的命令可以自动执行；
- 低置信度会主动询问并附可点击命令按钮，写操作始终要求用户确认；
- 支持 OpenAI Chat Completions 格式的官方或兼容 API。

> [!IMPORTANT]
> aiEnhance-plugin 不会让模型自由生成并执行任意命令。模型只能从本地提供的
> 候选 ID 中选择，最终命令由本地模板生成，并再次经过参数、风险、置信度和
> 目标插件规则校验。

## 功能特点

- **未命中兜底**：优先让 miao-plugin、waves-plugin 等原插件处理，只有全部
  未命中后才进入 AI。
- **普通对话**：支持按机器人、群、用户隔离的短期上下文记忆。
- **图片识别**：读取 QQ 图片消息段，支持文字加图片或仅发送图片。
- **自然语言命令**：例如“看看我的鸣潮体力”可以安全映射为 `~体力`。
- **角色归属白名单**：在调用模型前识别原神、鸣潮、星铁和绝区零角色，排除
  其他游戏的角色命令。
- **分级决策**：高置信度自动执行，中等置信度确认，低置信度继续询问。
- **兼容接口**：支持 Bearer API Key、自定义 Header、本地无鉴权服务以及
  JSON Schema / JSON Object 降级。
- **隐私保护**：疑似 Token、Cookie、JWT、API Key 或 QQBot 凭据的内容不会
  发送给 AI。
- **运行保护**：内置单用户限流、全局并发限制、群白名单、会话过期和防递归
  重派发。

## 支持范围

目前提供以下插件的显式命令预设：

| 插件 | 预设能力 |
| --- | --- |
| [miao-plugin](https://github.com/yoimiya-kokomi/miao-plugin) | 帮助、原神/星铁/绝区零日历、今日素材、角色面板、练度、抽卡记录、持有率、深渊/剧诗/危战统计 |
| [Yunzai-genshin](https://github.com/TimeRainStarSky/Yunzai-genshin) | 原神角色攻略图（`#角色攻略`） |
| [StarRail-plugin](https://github.com/TsukinaKasumi/StarRail-plugin) | 星铁角色攻略图（`*角色攻略`，可选安装） |
| [waves-plugin](https://github.com/ziyiLike/waves-plugin) | 帮助、登录教程、体力、卡片、探索度、挑战、深塔、角色面板/攻略/图鉴、日历、公告、抽卡记录、数据坞、练度、签到记录、兑换码、星声、持有率 |
| [xiaoyao-cvs-plugin](https://github.com/ctrlcvs/xiaoyao-cvs-plugin) | 帮助、版本、体力、图鉴、地图位置、米游社绑定教程、扫码登录 |

喵喵角色卡上的“攻略”按钮实际会把 `#角色攻略` 或 `*角色攻略` 交给上述
攻略插件，并不是 miao-plugin 自己处理。aiEnhance-plugin 会使用相同命令，
执行前确认对应攻略处理器已经加载。

鸣潮签到、开启自动签到和米游社扫码登录属于写操作，只会给出按钮确认，不会
自动执行。没有进入显式预设目录的命令仍可按原插件的准确命令使用，但不会由
AI 猜测后执行。

### 角色白名单

内置名单覆盖原神、鸣潮、星铁和绝区零。机器人启动后还会读取已安装插件的
原始角色预设，补充新角色和别名：

- 原神、星铁：`miao-plugin/resources/meta-{gs,sr}/character`；
- 鸣潮：`waves-plugin/resources/Alias/role.yaml`；
- 绝区零：若安装 `ZZZ-Plugin`，读取其 `defSet/alias.yaml`。

当前预设只为绝区零提供活动日历，没有绝区零角色面板或攻略命令。因此绝区零
名单用于阻止角色被错派到原神、星铁或鸣潮，不会编造不存在的命令。遇到跨游戏
同名角色时，机器人会先询问具体游戏。

## 环境要求

- [TRSS-Yunzai](https://github.com/TimeRainStarSky/Yunzai)
- Node.js 18 或更高版本；实际部署还需满足当前 TRSS-Yunzai 的 Node.js 要求
- pnpm
- 使用自然语言命令增强时，至少安装一个受支持的业务插件
- 一个支持 `POST /v1/chat/completions` 的 OpenAI 兼容 API
- 使用图片识别时，所选模型和兼容 API 还需要支持图片输入

QQ 按钮确认功能取决于当前适配器是否支持 `segment.button`。本项目已适配
Yunzai-QQBot-Plugin 的按钮数据格式；不支持按钮的适配器会自动退化为文字确认。

## 安装

推荐使用 Git 安装，方便后续更新。

在 **TRSS-Yunzai 根目录**执行：

```bash
git clone --depth=1 https://github.com/ziyiLike/aiEnhance-plugin.git ./plugins/aiEnhance-plugin
cd ./plugins/aiEnhance-plugin
pnpm install --prod
cd ../..
pnpm restart
```

如果不是使用 PM2 运行，请按你原来的方式重启 TRSS-Yunzai。

> [!NOTE]
> 插件目录名建议保持为 `aiEnhance-plugin`。不要直接下载单个 `index.js`，
> 本插件还需要 `src`、`config` 和 npm 依赖。

## 配置

### 1. 生成配置文件

安装并重启后，向机器人发送：

```text
#AI状态
```

首次读取配置时会自动创建：

```text
TRSS-Yunzai/config/aiEnhance.yaml
```

配置文件会尽量设置为仅当前系统用户可读写。你也可以在重启前手动复制：

```bash
cp ./plugins/aiEnhance-plugin/config/default.yaml ./config/aiEnhance.yaml
chmod 600 ./config/aiEnhance.yaml
```

### 2. 配置 OpenAI 兼容 API

编辑 `TRSS-Yunzai/config/aiEnhance.yaml`，至少填写模型和 API Key：

```yaml
api:
  baseUrl: https://api.openai.com/v1
  endpoint: /chat/completions

  # 推荐从环境变量读取密钥。
  apiKey: ""
  apiKeyEnv: OPENAI_API_KEY

  allowUnauthenticated: false
  model: "<你的模型名称>"

  timeoutMs: 20000
  retries: 1
  temperature: 0.2
  maxTokens: 900
  maxTokensField: max_tokens
  responseFormat: auto
  extraHeaders: {}
```

在启动机器人进程的环境中设置密钥：

```bash
export OPENAI_API_KEY="<你的 API Key>"
```

确保 PM2、Docker 或 systemd 启动的机器人进程也能读取该环境变量。若无法
设置环境变量，也可以把密钥填写到 `api.apiKey`；该配置文件位于 Yunzai 根
目录，不要把它提交到公开仓库。

如果机器人已经由 PM2 运行，刚修改环境变量后可以在 Yunzai 根目录执行：

```bash
pnpm exec pm2 restart config/pm2.yaml --update-env
```

配置完成后发送：

```text
#AI重载
#AI状态
```

这两个命令仅主人可用。

### 3. 本地无鉴权服务

例如本地服务监听 `127.0.0.1:8000`：

```yaml
api:
  baseUrl: http://127.0.0.1:8000/v1
  endpoint: /chat/completions
  apiKey: ""
  apiKeyEnv: ""
  allowUnauthenticated: true
  model: "<本地模型名称>"
```

非本机的明文 HTTP 地址默认会被拒绝。如确实在可信内网使用，需要显式设置：

```yaml
api:
  allowInsecureHttp: true
```

不建议把 API Key 通过公网明文 HTTP 发送。

### 4. 兼容性选项

`responseFormat: auto` 会依次尝试：

1. `json_schema`
2. `json_object`
3. 仅通过提示词要求返回 JSON

如果兼容服务不支持某种结构化输出，插件会自动尝试下一种。模型响应最终仍需
通过本地严格结构校验。

常见的 Token 参数可按服务要求调整：

```yaml
api:
  # 可选：max_tokens、max_completion_tokens、none
  maxTokensField: max_tokens

  # 某些模型不接受 temperature，可设为 null 省略。
  temperature: 0.2
```

### 5. 图片识别

图片识别默认开启。插件会读取适配器提供的图片地址，在本地限时下载后转换为
OpenAI Chat Completions 的 Base64 data URL，不会依赖第三方 API 再去访问 QQ
的临时图片链接：

```yaml
vision:
  enabled: true
  # 单条消息最多发送给模型的图片数量。
  maxImages: 3
  # 单张图片最大 5 MiB。
  maxBytesPerImage: 5242880
  timeoutMs: 10000
  # 可选：auto、low、high、original。
  detail: auto
  # 默认只允许 HTTPS 图片。
  allowInsecureHttp: false
```

支持 JPEG、PNG、WebP 和 GIF。`detail: auto` 默认不向兼容 API 发送 `detail`
字段；如果第三方服务明确支持，可以按需设置。图片输入的字段结构可参考
[OpenAI Images and vision 文档](https://developers.openai.com/api/docs/guides/images-vision)。

### 6. 群聊触发范围

默认情况下，私聊启用，群聊必须 `@机器人` 或使用 Yunzai 配置的机器人别名：

```yaml
trigger:
  privateEnabled: true
  requireAtInGroup: true
  allowAliasInGroup: true

  # 留空表示不限制群。
  enabledGroups: []
  disabledGroups: []
```

只允许指定群：

```yaml
trigger:
  enabledGroups:
    - "123456789"
    - "987654321"
```

### 7. 置信度与自动执行

默认策略：

```yaml
routing:
  autoExecuteEnabled: true
  autoExecuteConfidence: 0.92
  confirmConfidence: 0.65
  minAutoRetrievalScore: 0.18
  minAutoRetrievalMargin: 0.06
```

- 低于 `confirmConfidence`：继续询问，不生成确认命令；
- 达到 `confirmConfidence` 但不满足自动执行条件：请求确认；
- 达到 `autoExecuteConfidence`：仍需同时满足只读、自动执行白名单、本地召回
  分数和候选差值等条件，才会执行。

如需完全关闭自动执行：

```yaml
routing:
  autoExecuteEnabled: false
```

还可以通过 `commands.autoExecuteAllowlist` 缩小允许自动执行的候选范围。

从上一版本升级且从未修改过默认自动执行白名单时，插件会自动补充
`genshin.guide` 和 `starrail.guide`。自定义过
`commands.autoExecuteAllowlist` 的配置不会被改动，需要按需手动追加；也可以将
`commands.migrateLegacyAllowlist` 设为 `false`，完全关闭该兼容迁移。

## 使用方法

### 群聊

```text
@机器人 你好，介绍一下你自己
@机器人 图中有什么内容（同时发送图片）
@机器人 看看我的鸣潮体力
@机器人 胡桃的面板怎么样
@机器人 能给我看下遐蝶的面板吗
@机器人 给我木偶的攻略
@机器人 给我一份遐蝶的攻略
@机器人 我要执行原神扫码登录
@机器人 星铁最近有什么活动
@机器人 琉璃袋在哪里
```

### 私聊

私聊不需要 `@`：

```text
帮我看看本期深渊怎么配队
这个版本鸣潮有多少星声
无相之雷是什么怪
这张图里有哪些角色（同时发送图片）
```

### 管理命令

| 命令 | 权限 | 说明 |
| --- | --- | --- |
| `#AI帮助` | 所有人 | 查看基础使用说明 |
| `#AI清空会话` | 所有人 | 清除当前用户在当前会话中的短期记忆 |
| `#AI状态` | 主人 | 查看 API、模型、候选数量和配置问题 |
| `#AI重载` | 主人 | 重新读取配置和命令目录 |

## 工作方式

一次自然语言命令会经过以下流程：

1. Yunzai 先按正常优先级调用已有插件；
2. 没有插件处理时，aiEnhance-plugin 先用角色白名单确定游戏归属；
3. 本地排除跨游戏候选，再召回少量相关命令；
4. 模型只能返回 `chat`、`clarify` 或某个已提供的 `candidateId`；
5. 本地代码校验参数并根据受限模板生成命令；
6. 安全策略检查风险、白名单、置信度、召回分数和目标插件规则；
7. 满足自动执行条件时，带防递归标记重新交给 Yunzai 调度器。

用户身份、群身份、主人权限和成员对象会保留，AI 不会以机器人主人身份代替
普通用户执行命令。

## 自定义固定命令

可以在 `config/aiEnhance.yaml` 中加入其他插件的固定命令：

```yaml
commands:
  custom:
    - id: custom.my_help
      plugin: my-plugin
      description: 查看我的插件帮助
      command: "#我的帮助"
      intentExamples:
        - 我的插件怎么用
      keywords:
        - 我的插件
        - 帮助
      runtimeAliases:
        - my-plugin

      # 可选：read、write、sensitive、admin
      risk: read
      autoExecute: true
```

若希望只读命令自动执行，还需要把 ID 加入：

```yaml
commands:
  autoExecuteAllowlist:
    - custom.my_help
```

该数组会替换默认自动执行白名单。如果还希望内置只读命令自动执行，请在默认
列表末尾追加 `custom.my_help`，不要只保留这一项。

配置中的自定义项只支持固定命令。有参数的动态命令必须在代码中实现受限 slot、
生成模板和正则校验，避免命令注入。

## 隐私与安全

- 第三方 API 会接收到用户的普通对话文本、短期对话历史，以及用户主动附带的
  图片内容；
- 疑似 Cookie、Token、JWT、Authorization、API Key 或 QQBot 凭据的消息会在
  API 调用前拦截；
- API Key 不会出现在 `#AI状态` 或决策日志中；
- 审计日志只记录哈希后的会话身份、候选 ID、分数和决策，不记录原始消息；
- 会话默认保留最近 8 条消息，15 分钟后过期，并按机器人、群和用户隔离；
- 图片二进制、Base64 和 QQ 临时鉴权 URL 不会写入会话记忆或审计日志；
- 图片中的文字无法在发送前可靠执行密钥检测，请勿上传包含 Token、Cookie、
  登录二维码或其他凭据的截图；
- 群聊默认必须 `@机器人`，不会监听所有群消息；
- 模型无法绕过候选目录直接提供待执行命令；
- 写操作不会自动执行，敏感和管理类候选会被拒绝。

部署到公开群前，请确认所使用 API 服务的隐私政策，并向群成员说明消息可能
发送至第三方模型服务。

## 更新

在 TRSS-Yunzai 根目录执行：

```bash
git -C ./plugins/aiEnhance-plugin pull --ff-only
cd ./plugins/aiEnhance-plugin
pnpm install --prod
cd ../..
pnpm restart
```

更新前建议备份 `config/aiEnhance.yaml`。该配置位于 Yunzai 根目录，正常更新
插件不会覆盖它。

## 常见问题

### `#AI状态` 提示未配置

检查以下项目：

- `api.model` 是否填写；
- `api.apiKey` 或 `api.apiKeyEnv` 对应的环境变量是否存在；
- 无鉴权本地服务是否设置了 `allowUnauthenticated: true`；
- 修改后是否执行了 `#AI重载`。

### API 一直返回错误

先确认 `baseUrl` 是否已经包含 `/v1`，并避免与 `endpoint` 重复。再根据服务
文档检查模型名、`maxTokensField` 和 `temperature`。兼容性较弱的服务可保持
`responseFormat: auto`。

### 发送图片后仍提示不支持图片输入

插件能把 QQ 图片转换成标准的 Chat Completions `image_url` data URL，但不能
让纯文本模型获得视觉能力。请检查当前 `api.model` 是否支持图片输入，以及
第三方兼容服务是否完整支持多模态 Chat Completions。修改模型后执行
`#AI重载`。

如果提示“图片读取失败”，通常是 QQ 临时链接已过期、下载超时、图片超过
`vision.maxBytesPerImage`，或图片格式不受支持；请重新发送图片后再试。

### 群聊 `@` 后没有响应

- 确认插件已经加载且 `enabled: true`；
- 检查群是否在 `disabledGroups`，或是否不在 `enabledGroups`；
- 如果消息已经被前面的业务插件处理，AI 兜底不会再次回复；
- 查看 Yunzai 日志中是否有 `[aiEnhance-plugin]` 错误。

### 为什么高置信度仍然要求确认

模型置信度只是其中一个条件。命令还必须为只读、位于自动执行白名单，并满足
本地召回分数、候选差值和目标插件运行时规则。该行为属于安全设计。

### 为什么确认按钮没有显示

先确认 `reply.useButtons: true`，并升级到当前版本。若使用
Yunzai-QQBot-Plugin，其 `markdown.<机器人 ID>` 不要设置为 `legacy`；该模式
会由适配器忽略按钮。其他适配器若不支持 `segment.button`，插件会发送文字和
准确命令，用户可以自行复制或直接发送。

## 开发与验证

```bash
pnpm install
pnpm run check
pnpm test
pnpm run verify
```

测试使用本地模拟 API，不会调用真实 OpenAI 服务。

本项目实现时对照过以下上游版本：

| 项目 | Commit |
| --- | --- |
| TRSS-Yunzai | `a3d75d5` |
| Yunzai-QQBot-Plugin | `60a2e87` |
| miao-plugin | `46790f0` |
| Yunzai-genshin | `a48a571` |
| StarRail-plugin | `e1ecd66` |
| waves-plugin | `d0c5255` |
| xiaoyao-cvs-plugin | `e7ab3e8` |
| ZZZ-Plugin（仅角色归属预设） | `7bd0086` |

上游插件命令或 Yunzai 调度结构发生变化时，运行时校验会优先停止执行，而不是
盲目派发。

## 反馈与贡献

遇到问题请提交 [Issue](https://github.com/ziyiLike/aiEnhance-plugin/issues)。
提交问题时请附上：

- TRSS-Yunzai 与相关插件版本；
- 使用的 API 类型和模型名（请勿提交 API Key）；
- `#AI状态` 中不含敏感信息的部分；
- 可复现的自然语言输入和脱敏后的错误日志。

## License

[MIT](./LICENSE)
