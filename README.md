# aiEnhance-plugin

[![License](https://img.shields.io/github/license/ziyiLike/aiEnhance-plugin)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TRSS-Yunzai](https://img.shields.io/badge/TRSS--Yunzai-plugin-4f46e5)](https://github.com/TimeRainStarSky/Yunzai)

为 TRSS-Yunzai 提供 AI 对话和自然语言命令增强：

- 群聊直接 `@机器人`、私聊直接发送消息即可对话；
- 可以随消息发送或引用图片，让支持视觉的模型识别图片内容；
- 可以直接询问“纳西妲带什么圣遗物”，由模型读取现有攻略图后回答；
- 原有插件没有处理消息时，分析用户可能想使用的命令；
- 高置信度、只读且在白名单内的命令可以自动执行；
- 低置信度会主动询问并附可点击命令按钮，写入、敏感和管理操作始终要求确认；
- 支持 OpenAI Chat Completions 格式的官方或兼容 API。

> [!IMPORTANT]
> aiEnhance-plugin 不会让模型自由生成并执行任意命令。模型只能从本地提供的
> 候选 ID 中选择，最终命令由本地模板生成，并再次经过参数、风险、置信度和
> 目标插件规则校验。

## 功能特点

- **未命中兜底**：优先让 miao-plugin、waves-plugin 等原插件处理，只有全部
  未命中后才进入 AI。
- **普通对话**：支持按机器人、群、用户隔离的 20 轮滚动上下文记忆。
- **图片识别**：读取 QQ 图片消息段，支持文字加图片、仅发送图片或引用图片。
- **攻略图问答**：截获原神、星铁或鸣潮攻略图片，回答具体配装、词条、
  武器和培养问题；无法可靠回答时发送原攻略图。
- **模型原生联网**：攻略图没有答案时，通过 Responses API 的 `web_search`
  继续检索，并把模型采用的来源一并发给用户。
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

默认目录不是精选子集，而是逐文件核对以下五个上游插件的完整命令面。当前固定
版本共计 **353 条生效的静态规则和 5 个动态 `accept/check` 入口**，合并同义词
和同一参数族后形成 **324 个本地候选**：

| 插件 | 固定 Commit | 静态规则 | 动态入口 |
| --- | --- | ---: | ---: |
| [miao-plugin](https://github.com/yoimiya-kokomi/miao-plugin) | `1eaef54` | 59 | 2 |
| [Yunzai-genshin](https://github.com/TimeRainStarSky/Yunzai-genshin) | `4a2e1fb` | 67 | 3 |
| [StarRail-plugin](https://github.com/TsukinaKasumi/StarRail-plugin) | `090e411` | 54 | 0 |
| [waves-plugin](https://github.com/ziyiLike/waves-plugin) | `64f24d3` | 139 | 0 |
| [xiaoyao-cvs-plugin](https://github.com/ctrlcvs/xiaoyao-cvs-plugin) | `e7ab3e8` | 34 | 0 |

逐文件规则数、动态入口和候选 ID 的映射见
[命令完整性审计](./docs/command-audit.md)。`pnpm run check` 会校验清单内部总数、
逐文件计数、映射候选是否存在，以及是否有内置候选脱离审计清单。

喵喵角色卡上的“攻略”按钮实际会把 `#角色攻略` 或 `*角色攻略` 交给上述
攻略插件，并不是 miao-plugin 自己处理。aiEnhance-plugin 会使用相同命令，
执行前确认对应攻略处理器已经加载。

攻略图问答目前会读取以下命令的实际回复：

- 原神：`#角色攻略`；
- 星铁：`*角色攻略`；
- 鸣潮：`~角色攻略`。

例如“纳西妲带什么圣遗物”“遐蝶没有专武带什么光锥”“椿的声骸怎么配”会
先确定角色归属，再在后台获取攻略图。模型只允许依据图中清晰可见的内容回答；
图片没有覆盖问题、文字无法辨认或置信度不足时，不会用模型记忆硬猜。

Cookie、Token、手机号与验证码、抽卡链接、充值/消费记录、解绑/删除、批量任务、
插件更新、配置以及主人专用管理命令都在候选目录中，不按风险类型过滤。风险只
影响执行方式：只读白名单命令才可能自动执行；写入、敏感和管理命令只生成确认，
确认后仍由原插件校验用户、群和主人权限。`#更新抽卡记录`、`*更新抽卡记录` 与
`~更新抽卡记录` 也都按各自上游实现收录。

疑似真实凭据的原始消息仍会在调用模型前被本地拦截，避免把账号密钥发给第三方
API；用户直接发送准确的原插件命令时，仍由优先级更高的原插件正常处理。这项
隐私保护不等于从命令目录删除敏感或主人命令。

### 角色白名单

内置名单覆盖原神、鸣潮、星铁和绝区零。机器人启动后还会读取已安装插件的
原始角色预设，补充新角色和别名：

- 原神、星铁：`miao-plugin/resources/meta-{gs,sr}/character`；
- 鸣潮：`waves-plugin/resources/Alias/role.yaml`；
- 绝区零：若安装 `ZZZ-Plugin`，读取其 `defSet/alias.yaml`。

当前五个上游插件可提供绝区零日历、体力、邦布、公告、兑换码和 UID 等功能，
但没有绝区零角色面板或角色攻略处理器。因此绝区零名单仍会阻止角色被错派到
原神、星铁或鸣潮，不会编造不存在的角色命令。遇到跨游戏同名角色时，机器人会
先询问具体游戏。

## 环境要求

- [TRSS-Yunzai](https://github.com/TimeRainStarSky/Yunzai)
- Node.js 18 或更高版本；实际部署还需满足当前 TRSS-Yunzai 的 Node.js 要求
- pnpm
- 使用自然语言命令增强时，至少安装一个受支持的业务插件
- 一个支持 `POST /v1/chat/completions` 的 OpenAI 兼容 API
- 使用图片识别时，所选模型和兼容 API 还需要支持图片输入
- 使用联网补充时，模型服务还需要实现 OpenAI Responses `web_search`

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

### 5. 短期记忆

短期记忆默认保存每位用户在当前群聊或私聊中最近 20 轮对话，15 分钟没有继续
对话后自动过期。一轮包含一条用户消息和一条机器人回复：

```yaml
memory:
  enabled: true
  ttlSeconds: 900
  maxTurns: 20
  maxMessageChars: 1000
```

主人可以直接查询或修改轮次，无需重启或执行 `#AI重载`：

```text
#AI配置轮次
#AI配置轮次 20
```

支持 0 到 50 轮；设置为 0 会关闭会话记忆。命令会持久化修改
`config/aiEnhance.yaml`。旧版未修改过的 `maxMessages: 8` 会自动迁移为默认
20 轮；其他旧值按两条消息一轮换算。

图片不会以 Base64 写入记忆。模型看图时会同时生成一段不展示给用户的语义
摘要，记录主体、外观、可能类别或品种、可见文字等信息，供后续追问使用。

### 6. 图片识别

图片识别默认开启。插件会读取当前消息或被引用消息中的图片地址；新版 QQBot
引用事件会直接解析 `event.raw.msg_elements`，其他适配器则使用其提供的
`getReply/getMsg` 接口作为后备。在本地限时下载图片后，插件会将其转换为
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

### 7. 攻略图问答

攻略图问答默认开启：

```yaml
knowledge:
  enabled: true
  guideVisionEnabled: true

  # 留空时使用 api.model。
  model: ""
  minConfidence: 0.78

  # 最多读取两张攻略图，单张最大 10 MiB。
  maxGuideImages: 2
  maxBytesPerImage: 10485760
  imageTimeoutMs: 15000
  guideTimeoutMs: 45000
  modelTimeoutMs: 60000

  # 攻略文字通常较密；兼容接口不接受 detail 时改为 auto。
  detail: high
  temperature: 0.1
  maxTokens: 900
```

处理顺序为：

1. 角色白名单确定游戏和规范角色名；
2. 后台执行对应的只读攻略命令并截获回复，不提前发到群里；
3. 只读取 Yunzai 工作目录内的攻略图片并发送给视觉模型；
4. 达到 `minConfidence` 时发送文字答案和“查看完整攻略”按钮；
5. 无法回答时尝试已配置的联网搜索；
6. 搜索未开启或仍无可靠答案时，只发送一张尺寸合适的攻略图和“查看完整
   攻略”按钮，避免 QQBot 将多作者转发拆成大量被动回复。

视觉问答会优先选择尺寸正常的攻略图；如果只有超长图，则仅选择处理成本最低的
一张交给模型尝试。超长图不会直接回发 QQ，防止客户端显示破图，此时仍会提供
“查看完整攻略”按钮。攻略视觉请求单独使用 `modelTimeoutMs`，不再受普通对话
较短的 `api.timeoutMs` 限制。

后台获取攻略仍会尊重 `routing.autoExecuteEnabled` 和
`commands.autoExecuteAllowlist`。如果管理员关闭自动执行或移除了对应攻略
候选，插件不会绕过配置偷偷执行攻略命令。

### 8. 模型原生联网

攻略图无法回答时，默认通过同一模型的 Responses Web Search 继续检索。它会
复用主 API 地址、模型和密钥：

```yaml
knowledge:
  webSearch:
    enabled: true
    baseUrl: ""
    endpoint: ""
    apiKey: ""
    apiKeyEnv: ""
    model: ""
```

`baseUrl`、`model` 和密钥留空时会复用 `api` 配置，默认请求 `/responses`。
如果主兼容服务不支持 Responses Web Search，可以为搜索单独填写服务地址、
模型和密钥。该路径会强制模型实际调用 `web_search`，并把返回的网页来源附在
答案后。接口结构参考
[OpenAI Web search 文档](https://developers.openai.com/api/docs/guides/tools-web-search)。

这里不会部署或调用 SearXNG、网页爬虫等自建搜索后端；检索、访问网页和来源
引用均由模型服务原生的 `web_search` 工具完成。若模型服务没有提供该工具，
插件会安全回退到已经截获的攻略图。

若只希望模型采用指定网站，可以设置：

```yaml
knowledge:
  webSearch:
    allowedDomains:
      - example.com
      - guide.example.org
```

如果为模型联网单独配置了非本机明文 HTTP 地址，需要显式设置
`knowledge.webSearch.allowInsecureHttp: true`，不建议经公网明文传输密钥或
查询内容。

### 9. 群聊触发范围

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

### 10. 置信度与自动执行

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

从旧版本升级且从未修改过默认自动执行白名单时，插件会自动补充后来新增的安全
只读候选。自定义过 `commands.autoExecuteAllowlist` 的配置不会被改动，需要按需
手动追加；也可以将 `commands.migrateLegacyAllowlist` 设为 `false`，完全关闭该
兼容迁移。

## 使用方法

### 群聊

```text
@机器人 你好，介绍一下你自己
@机器人 图中有什么内容（同时发送图片）
@机器人 这个是什么（引用一条图片消息）
@机器人 看看我的鸣潮体力
@机器人 看看本期鸣潮海墟
@机器人 看看星铁体力
@机器人 胡桃的面板怎么样
@机器人 能给我看下遐蝶的面板吗
@机器人 给我木偶的攻略
@机器人 给我一份遐蝶的攻略
@机器人 纳西妲带什么圣遗物
@机器人 遐蝶没有专武带什么光锥
@机器人 椿的声骸和主词条怎么配
@机器人 我要执行原神扫码登录
@机器人 星铁最近有什么活动
@机器人 琉璃袋在哪里
@机器人 我怎么绑定原神
@机器人 我的绝区零 UID 是多少
@机器人 帮我原神签到
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
| `#AI配置轮次 20` | 主人 | 将每位用户的滚动上下文上限设为 20 轮，支持 0～50 |
| `#AI状态` | 主人 | 查看 API、模型、候选数量和配置问题 |
| `#AI重载` | 主人 | 重新读取配置和命令目录 |

## 工作方式

明确的角色养成问句会先进入攻略问答分支。该分支不允许模型生成命令，而是由
本地角色白名单直接选择受限攻略候选，截获攻略回复并把图片作为参考资料。只有
结构化结果明确标记可回答且达到置信度阈值时才发送答案。

一次自然语言命令会经过以下流程：

1. Yunzai 先按正常优先级调用已有插件；
2. 没有插件处理时，aiEnhance-plugin 先用角色白名单确定游戏归属；
3. 本地排除跨游戏候选，把完整的兼容命令目录和优先候选一起提供给模型；
4. 模型会比较完整目录，但只能返回 `chat`、`clarify` 或某个已提供的 `candidateId`；
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
- 攻略图问答会把已安装攻略插件返回的角色攻略图片发送给视觉模型；只允许读取
  Yunzai 工作目录内、格式和大小通过校验的图片；
- 开启联网补充后，模型服务的 Responses `web_search` 会接收到游戏、角色和
  问题；
- 疑似 Cookie、Token、JWT、Authorization、API Key 或 QQBot 凭据的消息会在
  API 调用前拦截；
- API Key 不会出现在 `#AI状态` 或决策日志中；
- 审计日志只记录哈希后的会话身份、候选 ID、分数和决策，不记录原始消息；
- 会话默认滚动保留最近 20 轮，15 分钟后过期，并按机器人、群和用户隔离；
- 图片二进制、Base64 和 QQ 临时鉴权 URL 不会写入会话记忆或审计日志；会话
  仅保存模型生成的图片语义摘要；
- 图片中的文字无法在发送前可靠执行密钥检测，请勿上传包含 Token、Cookie、
  登录二维码或其他凭据的截图；
- 群聊默认必须 `@机器人`，不会监听所有群消息；
- 模型无法绕过候选目录直接提供待执行命令；
- 写操作不会自动执行；敏感和管理类候选会要求确认，并保留原插件权限校验。

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

### 为什么问配装时只返回攻略图

这表示插件找到了攻略，但模型没有达到 `knowledge.minConfidence`，或图片中
没有清晰覆盖所问条件。插件会优先发送原攻略，而不是用模型记忆补全答案。

还可以检查：

- `vision.enabled` 和 `knowledge.guideVisionEnabled` 是否开启；
- `knowledge.detail` 是否适合当前兼容接口；
- 对应攻略候选是否仍在 `commands.autoExecuteAllowlist`；
- 当前模型是否支持图片输入；
- `knowledge.webSearch.enabled` 是否开启。

### 开启联网后仍然只返回攻略图

该功能要求目标模型服务真正实现 Responses API 和 `web_search` 工具，普通
`/chat/completions` 兼容服务通常没有该能力。查看日志是否出现“联网攻略问答
失败”；如果当前服务不支持，可以为 `knowledge.webSearch` 单独配置另一个
支持模型原生搜索的 API 地址、模型和密钥。

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
| miao-plugin | `1eaef54` |
| Yunzai-genshin | `4a2e1fb` |
| StarRail-plugin | `090e411` |
| waves-plugin | `64f24d3` |
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
