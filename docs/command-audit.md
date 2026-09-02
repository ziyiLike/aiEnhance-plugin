# 命令完整性审计

这份审计用于证明默认命令目录覆盖的是上游插件的完整命令面，而不是从帮助菜单
或搜索结果中挑选的一部分。审计基线固定在 2026-09-02 拉取的以下提交：

| 上游插件 | Commit | 生效静态规则 | 动态入口 |
| --- | --- | ---: | ---: |
| [miao-plugin](https://github.com/yoimiya-kokomi/miao-plugin) | `1eaef54` | 59 | 2 |
| [Yunzai-genshin](https://github.com/TimeRainStarSky/Yunzai-genshin) | `4a2e1fb` | 67 | 3 |
| [StarRail-plugin](https://github.com/TsukinaKasumi/StarRail-plugin) | `090e411` | 54 | 0 |
| [waves-plugin](https://github.com/ziyiLike/waves-plugin) | `64f24d3` | 139 | 0 |
| [xiaoyao-cvs-plugin](https://github.com/Ctrlcvs/xiaoyao-cvs-plugin) | `e7ab3e8` | 34 | 0 |
| **合计** |  | **353** | **5** |

完整性核对不只搜索命令文字，而是依次检查：

1. 实际加载的 `apps` 源码中每个生效的 `rule` / `reg` 声明；
2. 不出现在静态规则数组中的 `accept()` / `check()` 动态分发入口；
3. 规则引用的变量正则、前缀和同义词；
4. 帮助菜单与处理函数，用来发现同一规则中的参数族和隐含模式；
5. 本地候选能否生成通过自身模板及运行时上游规则校验的命令。

逐文件计数、动态入口和所覆盖候选 ID 的机器可读映射保存在
[`src/catalog/upstreamAudit.js`](../src/catalog/upstreamAudit.js)。命令模板及风险
分级保存在 [`src/catalog/presets.js`](../src/catalog/presets.js)。一条上游正则通常
包含多个前缀、同义词或参数分支，因此 353 条静态规则被整理为 324 个可维护的
候选，而不是简单复制成 353 个固定字符串。

当前候选风险分布如下：

| 风险 | 候选数 | 默认行为 |
| --- | ---: | --- |
| `read` | 174 | 只有启用自动执行、进入白名单且置信度与召回差值达标时才自动执行 |
| `write` | 45 | 始终确认 |
| `admin` | 68 | 始终确认，之后继续由上游检查主人或管理权限 |
| `sensitive` | 37 | 始终确认；真实凭据消息不会发送给模型 |
| **合计** | **324** |  |

敏感与管理命令没有从目录中过滤。Cookie/Token、登录、抽卡链接、支付记录、解绑、
删除、批量任务、插件更新、配置和主人命令都具有明确候选。风险标签只限制自动
执行，不改变上游插件原本的权限规则。

## 自动检查

运行：

```bash
pnpm run check
```

检查会失败于以下任一情况：

- 五个插件的逐文件规则数与声明总数不一致；
- 静态规则文件或动态入口没有候选映射；
- 映射引用了不存在的候选；
- 任一内置候选没有来源映射；
- 候选示例无法通过本地命令模板。

上游版本升级时，必须重新走源码、动态入口和处理函数三层核对，并同时更新规则
模板、审计映射和固定 Commit；不能只靠关键词搜索或帮助图片判断“已经搜全”。
