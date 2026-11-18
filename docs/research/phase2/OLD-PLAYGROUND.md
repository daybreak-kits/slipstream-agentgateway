# 旧仓「模型试验」游乐场调研（Phase 2）

> 调研范围：旧仓 llmapi/web/src 的 playground 相关页面、组件、lib 与 docs/ssot.md；对照新仓 slipstream/web/src 同名模块。
> 方法：只读静态阅读（无浏览器实测、无构建、无 git 操作），所有结论都能由下列 file:line 复现。
> 时间：2026-11-17。旧仓文件快照 mtime 为 2025-11-15/16。
> 边界：本文只描述旧仓现状与新仓差距，不含实施方案；未读取后端实现，涉及后端的结论只引用前端代码与 ssot 文字。

## 0. 结论摘要

- 旧仓模型试验是**单会话、单列、底部输入**的聊天页：没有左会话列表，也没有右参数面板；「参数控制」是底部输入区里的一块可折叠抽屉（components/playground/chat-composer.tsx:125-142）。
- 参数面做成 20 项全量 OpenAI Chat Completions 透传台：4 个分组（系统 / 采样 / 输出 / 高级，chat-params-panel.tsx:285、343、404、485），每项说明文案集中在 lib/playground.ts:851-883 的 PARAM_HINTS，悬停参数名出 Tooltip（chat-params-panel.tsx:89-119）。
- 模型选择器是手写 ARIA 1.2 combobox（components/playground/model-combobox.tsx:26-39），**只做搜索**（调用名 / 渠道名 / 上游模型名，lib/playground.ts:801-807）；**没有分组头、没有最近使用、没有不可用置灰**——不可用条目根本不出现在列表里。
- 会话只有一条：localStorage 键 llmapi.playground.history.v1（lib/playground.ts:750），存一个扁平消息数组，上限 200 条（:753）；**没有重命名、删除、导出、导入**，只有「清除记录」（pages/playground.tsx:280-286）。
- 用量回显 7 项（输入 / 输出 / 总计 / 成本 / TTFT / 总耗时 / 吞吐，message-list.tsx:23-58），但前端只能自己算出 4 项；**成本、吞吐、估算标记只有合并管理端日志后才有**（lib/playground.ts:1116-1132）。
- 新仓已经把布局升级为三栏（左会话 lg:w-56 / 中消息 flex-1 / 右参数 lg:w-72，pages/playground.tsx:448-498），并补了会话管理，但**参数面板从 20 项缩到 5 项**、**模型选择退回普通 Select（无搜索）**、**附件 / API 密钥 / 非流式请求 / 请求编号 / 自动滚动全部丢失**（详见第 6 节，共 18 项回退）。
- 新仓 lib/playground.ts 里 PARAM_HINTS（:945）、paramHintText（:974）、validateChatParams（:1013）、summarizeChatParams（:1121）、maxOutputTokensFor（:983）**仍然存在但无任何 UI 引用**——迁移缺的是接线，不是实现。

## 1. 参数完整清单

### 1.1 口径说明

- **前端状态类型统一是 string**（ChatParamInput，lib/playground.ts:817-837）：数字也按字符串存，空串表示「这次不发」。
- **请求字段类型由 chatParamsFromInput 转换**（lib/playground.ts:996-1024）：parseOptionalNumber（:810-815）把空串/非数字转成 undefined，undefined 字段不写进 body（:184-187）。
- **默认值只有 temperature**：DEFAULT_PARAMS = { temperature: "0.7" }（pages/playground.tsx:35）；其余全部空串 = 不发送。占位符只提示惯例默认，不是真默认。
- **步进：全部没有**。所有数值项都是自由文本 Input（inputMode=decimal|numeric，chat-params-panel.tsx:132-155），没有 slider / stepper / min-max step；范围只在 validateChatParams 里做拦截，不在控件层限制。
- **只对下一次请求生效**：提交后 setParams(DEFAULT_PARAMS) 复位（pages/playground.tsx:262-263），面板头部有 Badge 明示（chat-params-panel.tsx:282）。
- **hover 文案唯一来源**：PARAM_HINTS（lib/playground.ts:851-875）+ paramHintText(key, range?) 拼成「range · usage」（:880-883）。表格「hover 来源」列只标 PARAM_HINTS 的行号，实际渲染在 chat-params-panel.tsx:110-113。

### 1.2 会话级（分组「系统」，chat-params-panel.tsx:285-339）

| 参数（UI） | 请求字段 | 状态类型 | 默认 / 占位 | 范围与校验 | 步进 | hover 文案来源 | 控件来源 |
|---|---|---|---|---|---|---|---|
| 系统提示词 | messages 首条 system（lib/playground.ts:1073-1077） | string，默认 ""（pages/playground.tsx:58） | 占位「可选：作为 system 消息放在上下文最前」（chat-params-panel.tsx:301） | 无校验；trim 为空则不发（lib/playground.ts:1075-1076） | 无 | lib/playground.ts:871 | chat-params-panel.tsx:291-305 |
| API 密钥 | 不进 body；Authorization: Bearer（lib/playground.ts:414-417、430-431、531-533） | string，仅内存（pages/playground.tsx:57） | 占位「留空使用当前登录会话」（chat-params-panel.tsx:317），type=password（:314） | 无；留空回落 getStoredToken()（lib/playground.ts:416） | 无 | lib/playground.ts:872 | chat-params-panel.tsx:307-322 |
| 流式（SSE） | stream: true / false（lib/playground.ts:436、537） | boolean，默认 true（pages/playground.tsx:60） | 默认开 | 无 | 无（开关） | lib/playground.ts:873 | chat-params-panel.tsx:324-330 |
| 渠道思考等级（只读） | 不发送，仅展示 | string，取 selected.parameters.reasoning_level（pages/playground.tsx:326） | 空值显示「未配置」（chat-params-panel.tsx:189） | 只读，长文本截断 + Tooltip 看全文（:188-206） | — | lib/playground.ts:874 | chat-params-panel.tsx:332-337 |

### 1.3 采样（chat-params-panel.tsx:343-400）

| 参数（UI） | 请求字段 | 状态类型 | 默认 / 占位 | 范围与校验 | 步进 | hover 文案来源 | 控件来源 |
|---|---|---|---|---|---|---|---|
| temperature | temperature | string | 默认 "0.7"（pages/playground.tsx:35）；占位 0.7 | 0–2；非数字或越界拦下（lib/playground.ts:935-937） | 无 | lib/playground.ts:852 | chat-params-panel.tsx:349-356 |
| top_p | top_p | string | 空；占位「默认」 | 0–1（lib/playground.ts:938-940） | 无 | lib/playground.ts:853 | chat-params-panel.tsx:357-364 |
| top_k | top_k | string | 空 | ≥0 的整数（lib/playground.ts:941-943） | 无（inputMode=numeric，:369） | lib/playground.ts:854 | chat-params-panel.tsx:365-373 |
| seed | seed | string | 空 | 整数（lib/playground.ts:956-958） | 无（numeric，:378） | lib/playground.ts:857 | chat-params-panel.tsx:374-382 |
| frequency_penalty | frequency_penalty | string | 空 | −2–2（lib/playground.ts:944-949） | 无 | lib/playground.ts:855 | chat-params-panel.tsx:383-390 |
| presence_penalty | presence_penalty | string | 空 | −2–2（lib/playground.ts:950-955） | 无 | lib/playground.ts:856 | chat-params-panel.tsx:391-398 |

### 1.4 输出（chat-params-panel.tsx:404-481）

| 参数（UI） | 请求字段 | 状态类型 | 默认 / 占位 | 范围与校验 | 步进 | hover 文案来源 | 控件来源 |
|---|---|---|---|---|---|---|---|
| max_tokens | max_tokens | string | 空；占位「不限」 | 1–limit，limit = 模型 parameters.max_output_tokens，未登记/0 回退 32768（lib/playground.ts:886-891、959-961；pages/playground.tsx:86-88） | 无（numeric，:413） | lib/playground.ts:858，区间由页面覆盖为「1–limit（未登记，回退 32768）」（chat-params-panel.tsx:417-420） | chat-params-panel.tsx:410-421 |
| max_completion_tokens | max_completion_tokens | string | 空；占位「默认」 | 1–limit（lib/playground.ts:962-970） | 无（numeric，:426） | lib/playground.ts:859，区间覆盖见 :429 | chat-params-panel.tsx:422-430 |
| n | n | string | 空；占位「默认 1」 | 1–128（lib/playground.ts:971-973） | 无（numeric，:435） | lib/playground.ts:861 | chat-params-panel.tsx:431-439 |
| response_format | response_format | enum text / json_object | 默认 text（chat-params-panel.tsx:271） | 只有 json_object 才进 body（lib/playground.ts:1014-1015） | —（Select） | lib/playground.ts:862 | chat-params-panel.tsx:440-468；选项文案 :72-75、464-465 |
| stop（多值） | stop: string[] | string，每行一条 | 空；占位「每行一条，最多 4 条」（:475） | 最多 4 条（lib/playground.ts:974-976）；解析保序去空行（:904-909） | 无 | lib/playground.ts:860 | chat-params-panel.tsx:469-479 |

### 1.5 高级（chat-params-panel.tsx:485-574）

| 参数（UI） | 请求字段 | 状态类型 | 默认 / 占位 | 范围与校验 | 步进 | hover 文案来源 | 控件来源 |
|---|---|---|---|---|---|---|---|
| logprobs | logprobs | boolean | false | 只在 true 时发送（lib/playground.ts:1016）；关闭时清空 top_logprobs（chat-params-panel.tsx:495-501） | —（Checkbox） | lib/playground.ts:863 | chat-params-panel.tsx:491-503 |
| top_logprobs | top_logprobs | string | 空；logprobs 关闭时固定空（:509） | 0–20 且需先开 logprobs（lib/playground.ts:977-984） | 无（numeric，:507） | lib/playground.ts:864 | chat-params-panel.tsx:504-512 |
| user | user | string | 空；占位「可选」 | ≤256 字符（lib/playground.ts:985-987） | 无 | lib/playground.ts:865 | chat-params-panel.tsx:513-523 |
| 思考 | reasoning_effort / thinking / enable_thinking（三选一按模式映射） | enum off·none·low·medium·high·max·thinking·enable_thinking（lib/playground.ts:94-102） | 默认 off（chat-params-panel.tsx:267；lib/playground.ts:998） | 无区间校验；映射见 lib/playground.ts:998-1022 | —（Select） | lib/playground.ts:866-869 | chat-params-panel.tsx:524-555；八档文案 :61-70 |
| 额外请求字段（JSON） | 逐键并入 body（保留键除外） | string → object | 空；占位见 :566 | 必须是 JSON 对象，空=不发（lib/playground.ts:198-210） | — | lib/playground.ts:870 | chat-params-panel.tsx:556-572 |

思考下拉的完整文案（chat-params-panel.tsx:61-70）：不指定（沿用渠道默认）/ reasoning_effort=none（关闭）/ low / medium / high / max / thinking.enabled（DeepSeek）/ enable_thinking（Qwen）。映射到请求体只有三种写法：none..max → reasoning_effort（lib/playground.ts:999-1002、1019）；thinking → thinking: {type: "enabled"}（:1020）；enable_thinking → enable_thinking: true（:1021）。

### 1.6 请求体拼装与校验时机

- **extraFields 先写，标准字段覆盖**；保留键 model / messages / stream / stream_options 永远不采纳（lib/playground.ts:176、179-189）。
- **校验在每次渲染时跑**（pages/playground.tsx:86-88），不合法时 canSend=false（:89-94），错误文案直接显示在输入框下方（chat-composer.tsx:281-283）。
- **第一个错误即返回**（lib/playground.ts:935-992），不同时报告多条。
- **摘要条**：输入区顶部一行 summarizeChatParams（chat-composer.tsx:117-122；实现 lib/playground.ts:1027-1054），只列这次真正会发的字段，全空显示「全部默认」。
- **折叠**：四个分组各自 Collapsible，默认全展开（chat-params-panel.tsx:218-240、259-264）。
- **附件文本化**：附件不参与参数面板，而是拼进用户消息正文（lib/playground.ts:1060-1067），格式「[附件 名字]\n内容」。

## 2. 模型选择器交互

旧仓唯一实现：components/playground/model-combobox.tsx（213 行，手写 ARIA 1.2 combobox，无第三方）。

### 2.1 结构与搜索

- 输入框本身即触发器：role=combobox、aria-autocomplete=list、aria-activedescendant 指向高亮项（model-combobox.tsx:165-190）。
- 搜索是**纯前端过滤**，无防抖、无请求：filterCatalogEntries 把 name + channel_name + upstream_model 拼成一个串做小写包含匹配（lib/playground.ts:801-807）。中文/英文、调用名、渠道名、上游模型名任一命中即可。
- 空查询返回全部；大小写不敏感；首尾空格被 trim（:802-803）。
- 无结果时显示一行「没有匹配的模型」（model-combobox.tsx:204-206）。
- 打开或换关键词后，高亮重置到第一条（:105-109）。

### 2.2 分组

- **没有分组头 / 分组折叠**，listbox 是扁平列表（:207-256），顺序等于目录接口顺序。
- 「分组」只体现为行内后缀标签 optionLabel（:26-32）：组合 → 「名字 · 自动组合 / 手动组合」；直连 → 「名字 · 渠道名」或「名字」。
- 页头另有一行路由说明（pages/playground.tsx:298-301，实现 :45-52）：「直连 · 渠道名」或「自动组合 · 按优先级分层路由，同层等概率随机」。
- 可用模型数量以 Badge 放在页头右侧（pages/playground.tsx:303）。

### 2.3 思考等级 / 推理强度

- 选择器里**没有**思考等级展示或选择。
- 发送区右侧有一枚只读徽标「思考等级 X / 未配置」（chat-composer.tsx:247-250），数据来自所选模型的 parameters.reasoning_level（pages/playground.tsx:326）。
- 参数面板「系统」组还有一格只读的「渠道思考等级」（chat-params-panel.tsx:332-337）。
- 真正控制本次请求推理强度的是高级组的「思考」下拉（:524-555），两者不是同一个东西：前者是渠道登记值（不改请求），后者是本次请求字段（lib/playground.ts:874 文案已明确「仅作默认提示，不改请求」）。

### 2.4 最近使用

- **没有**。没有任何 localStorage 记录、没有 MRU 排序、没有「上次选择」回填。
- 默认选中目录第一条：useQuery 拉到后若 model 为空则 setModel(models[0].name)（pages/playground.tsx:72-77）。
- 目录查询 key 固定 ["catalog-entries"]（:64-70），没有 staleTime / 缓存持久化设置。

### 2.5 不可用置灰

- **没有置灰，也没有禁用项**；原因是不可用条目根本不会下发到试验页：listCatalogEntries 默认不带 include_disabled（lib/playground.ts:726-731），ssot 也写明调用面默认只返回可调用模型（docs/ssot.md:549 末段）。
- 目录条目其实带齐了可用性字段：health_status / visible_status / cooldown_until / fault_until / consecutive_failures / cooldown_reason（lib/playground.ts:700-719），但 combobox 与页面**一个都没消费**。
- 结果：试验页只能「有 / 没有」模型，看不到「熔断 / 半开 / 冷却中 / 近期连续失败」这些状态，也没有「不可用但仍可见」的入口。

### 2.6 键盘与浮层方向

- ArrowDown / ArrowUp：未打开时打开；已打开时移动高亮，到边界钳住（model-combobox.tsx:128-140）。
- Enter：选中当前高亮项（:142-149）；Escape：关闭并清空关键词（:150-155）；Tab：关闭并允许焦点离开（:156）。
- 失焦关闭：relatedTarget 不在容器内则关闭（:158-164）。
- 浮层方向：打开前量上下可用空间，下方 < 200px 且上方更大时向上弹（:100-111、220-224）。
- 选中项右侧打勾（:243-249）；鼠标按下 preventDefault 以保持输入焦点（:238）。
- 宽度 w-44 sm:w-56、高 h-9（chat-composer.tsx:245；model-combobox.tsx:165）。

## 3. 会话与历史

### 3.1 存储键与容量

- 键：llmapi.playground.history.v1（lib/playground.ts:750）。**单键、单会话**，值就是一个消息数组。
- 上限：PLAYGROUND_HISTORY_LIMIT = 200 条，读写两端都 slice(-200)（:753、1140、1159）。
- 明确不与 lib/storage.ts 的系统键混用（history-store.ts:8-10），避免覆盖登录态与主题。

### 3.2 消息结构（lib/playground.ts:777-798）

- 必填：id（"pg-" + 时间基36 + 随机，pages/playground.tsx:37-39）、role（system|user|assistant）、content、createdAt。
- 可选：model、streaming、stopped、streamed、reasoning、thinkingLabel、error、requestId、usage、attachments。
- 权限判断 isPlaygroundMessage 只校验 id/role/content/createdAt（lib/playground.ts:1146-1155），其余字段缺失即忽略——旧数据向前兼容靠这个宽松校验。

落盘形状（序列化后，streaming 恒为 false）：

    [
      {
        "id": "pg-m3k2x9-ab12cd",
        "role": "user",
        "content": "给这句话分类……",
        "createdAt": 1763212345678,
        "attachments": [{ "name": "a.txt", "size": 12, "text": "……" }]
      },
      {
        "id": "pg-m3k2x9-ef34gh",
        "role": "assistant",
        "content": "……",
        "model": "gpt-4o-mini",
        "createdAt": 1763212345999,
        "streaming": false,
        "streamed": true,
        "reasoning": "……",
        "thinkingLabel": "reasoning_effort=high",
        "requestId": "req-…",
        "usage": { "promptTokens": 12, "completionTokens": 34, "totalTokens": 46, "ttftMs": 180, "elapsedMs": 1200, "throughput": null, "costUsd": 0.000123, "estimated": false }
      }
    ]

### 3.3 多轮结构

- 状态是一个扁平数组，一问一答顺序追加：提交时先拼 [历史…, user, 空 assistant 占位]（pages/playground.tsx:117-134），流式逐帧只改占位那条的 content（:146-152）。
- 发给上游时调 toRequestMessages(history, systemPrompt)（:137；lib/playground.ts:1073-1083）：system 提示词置顶；**跳过 transcript 里的 system 消息**；**跳过 content 为空的 assistant 消息**（失败或空响应不污染上下文）。
- 重试是「截断到最后一个 user 之前再重发」：handleRetry 找到最后一个 user 下标，base = slice(0, idx)，然后用同一 content 再跑一次（pages/playground.tsx:267-274）。
- 附件在发送前就被 buildUserContent 折进用户正文（lib/playground.ts:1060-1067），上游只看到文本。

### 3.4 写入时机与容错

- 每次 messages 变化都写；但最后一条还在 streaming 时跳过，避免每个 token 写一次盘（pages/playground.tsx:79-84）。
- 读失败 → 空会话；写失败（隐私模式 / 配额）→ 静默忽略，本次会话照常（history-store.ts:13-26）。
- 解析失败或不是数组 → 返回 []（lib/playground.ts:1135-1144）。

### 3.5 重命名 / 删除 / 清空

- **重命名：没有**。消息与会话都没有标题概念。
- **删除单条消息：没有**；**删除会话：没有**（只有一个会话）。
- 只有整段清空：「清除记录」按钮（chat-composer.tsx:226-236）→ ConfirmDialog「清除聊天记录？/ 只清掉这台设备浏览器里保存的聊天记录，不影响后端日志。」（pages/playground.tsx:352-360）→ setMessages([]) + clearPlaygroundHistory()（:280-286）。

### 3.6 导出 / 导入

- **两者都没有**。history-store.ts 只有 load / save / clear 三个函数（:13-35）；全目录 grep「导出 / 导入 / download」在 components/playground 下零命中。
- 事实上落盘格式就是纯 JSON 数组（3.2 的示例），可手工拷贝，但没有 UI 入口，也没有版本号 / schema 字段（版本只体现在键名 v1）。

## 4. 用量回显

展示载体：助手气泡下方的 UsageRow（components/playground/message-list.tsx:23-58），7 个指标一行 flex-wrap，dt 文案 + dd 等宽数字。

| 指标 | 字段 | 前端来源 | 显示格式化 | 边界行为 |
|---|---|---|---|---|
| 输入词元 | promptTokens | 上游 usage.prompt_tokens（pages/playground.tsx:178-180、206-208） | 原样数字（message-list.tsx:28） | 上游不回 usage 时 0 |
| 输出词元 | completionTokens | 上游 usage.completion_tokens（同上） | 原样（:32） | 同上 |
| 总计 | totalTokens | 上游 total_tokens，缺则 p+c（lib/playground.ts:1103） | 原样（:36） | — |
| 成本 | costUsd | **仅**管理端日志 cost_usd（lib/playground.ts:1129） | formatCostOrUnconfigured（lib/format.ts:56-62） | 无日志 →「—」；有 token 但成本 0 →「未配置单价」（format.ts:47-53） |
| TTFT | ttftMs | 流式首个 content delta 的 performance.now 差（lib/playground.ts:620-622、630-633）；非流式恒空；日志 ttft_ms 覆盖（:1126） | formatDuration → "0.18s"（lib/duration.ts:14-18） | null →「—」 |
| 总耗时 | elapsedMs | performance.now 起止差（lib/playground.ts:449、682）；日志 total_ms 覆盖（:1127） | formatDuration | null →「—」 |
| 吞吐 | throughput | **仅**日志 throughput_tps（:1128） | formatThroughput → "12.3 t/s"（lib/format.ts:101-104） | 无日志恒「—」 |

合并链路：请求结束后 refreshLog 拉 /api/logs/recent?limit=20（lib/playground.ts:410-412），按 request_id 精确匹配（pages/playground.tsx:95-108），命中才 mergeLogUsage（lib/playground.ts:1116-1132：日志优先、缺字段保留浏览器值、estimated = log.usage_estimated || 原值）；拉取失败静默（pages/playground.tsx:100-104）。

三个必须知道的口径问题：

1. **前端 TTFT 不含思考**：只有 content delta 才触发 ttft（lib/playground.ts:620-622、631），reasoning delta 不计（:607-618）。纯推理流的浏览器侧 TTFT 恒为「—」，要等日志合并才有值。而后端 ttft_ms 的契约含 reasoning（docs/ssot.md:166）。
2. **吞吐在日志不可用时永远是「—」**：页面两次 buildUsage 都没传 throughput（pages/playground.tsx:178-190、206-217），所以浏览器侧算不出来。
3. **成本 / 估算标记同理**：buildUsage 未传 costUsd / estimated，estimated 恒 false，只有日志的 usage_estimated 能把它翻成 true（lib/playground.ts:1130）。

另外：非流式请求没有 TTFT（buildUsage 不传 ttftMs），这是设计如此（docs/ssot.md:170 的「非流式没有 TTFT」）。

## 5. 布局尺寸

### 5.1 旧仓实际尺寸

| 区域 | 尺寸 / 类名 | 来源 |
|---|---|---|
| 页面外框 | flex flex-col，h-[calc(100dvh-8rem)]，min-h-0，gap-3 | pages/playground.tsx:292 |
| 页头 | flex-wrap justify-between gap-2；标题 text-h1；副标题 text-2sm；路由说明 text-2xs；右侧 outline 徽标 | pages/playground.tsx:293-304 |
| 消息区 | min-h-0 flex-1 overflow-y-auto；内层 mx-auto max-w-3xl gap-4 py-4 | components/playground/message-list.tsx:199-200 |
| 消息气泡 | max-w-[85%]；text-2sm leading-6；用户 bg-primary-soft，助手 border + bg-surface | message-list.tsx:120-125 |
| 思考块 | 默认折叠；展开后 max-h-64 overflow-y-auto | message-list.tsx:77-97（:93 定高） |
| 空状态 | max-w-3xl，h-full 居中 | message-list.tsx:184-196 |
| 输入区外框 | shrink-0；内部卡片 p-2；参数抽屉卡片 p-4 | pages/playground.tsx:320；chat-composer.tsx:143、127 |
| 输入框 | min-h-21 max-h-56，随内容增高、上限 224px 后内部滚动 | chat-composer.tsx:177、93-98 |
| 模型 combobox | h-9；w-44，sm:w-56；浮层 max-h-72 | chat-composer.tsx:245；model-combobox.tsx:165、220 |
| 发送 / 停止钮 | w-24 | chat-composer.tsx:256、266 |
| 参数网格 | 1 列 / sm:2 / lg:4 / xl:6；字段 gap-1；控件 h-9 | chat-params-panel.tsx:53、55、151 |
| 应用侧栏 | 248px（--width-sidebar / w-sidebar）；折叠 w-18；<lg 为抽屉 | web/src/index.css:41；components/layout/sidebar.tsx:20；components/layout/app-shell.tsx:36 |

### 5.2 关于「左会话 / 中消息 / 右参数面板」

- **旧仓不是三栏**：页面只有一个 flex-col（pages/playground.tsx:292），消息在上、输入与参数在下；components/playground 目录只有 5 个文件（chat-composer / chat-params-panel / history-store / message-list / model-combobox），没有 session-list，也没有独立 params 面板。
- **三栏是新仓**：pages/playground.tsx:448-498 用 lg:flex-row 拼三块——左 aside lg:w-56 shrink-0（:449）、中 section flex-1 min-w-0（:462）、右 aside lg:w-72 shrink-0（:486)；<lg 时按 order-2 / order-1 / order-3 堆叠（会话在消息下方），整页 lg:h-[calc(100vh-5rem)]，中栏 lg 以下 min-h-[60vh]。
- 两仓的消息列都限制在 max-w-3xl（旧 message-list.tsx:200；新 message-list.tsx:202），新仓输入区内部也是 max-w-3xl（新 composer.tsx:27）。

### 5.3 响应式

- 旧仓断点全在参数网格与 combobox 宽度上：sm:grid-cols-2 / lg:grid-cols-4 / xl:grid-cols-6（chat-params-panel.tsx:53），combobox w-44 → sm:w-56（chat-composer.tsx:245）。
- 页面高度用 100dvh 减 8rem，适配移动浏览器地址栏伸缩（pages/playground.tsx:292）。
- ssot 的硬要求是 375 / 768 / 1280 三档 + 侧栏 248px、平板折叠、移动抽屉（docs/ssot.md:543）。

## 6. 与新仓差距

对照文件：slipstream/web/src/pages/playground.tsx、components/playground/{composer,message-list,params-panel,session-list,sessions}.ts(x)、lib/playground{,-params,-model-options}.ts。

### 6.1 差距总表

| # | 能力 | 旧仓（llmapi/web/src） | 新仓（slipstream/web/src） | 判定 |
|---|---|---|---|---|
| 1 | 参数项数量 | 20 项四组（components/playground/chat-params-panel.tsx:285-574） | 5 项 + 模型 + 系统提示词 + 流式开关（lib/playground-params.ts:2-9；components/playground/params-panel.tsx:115-186） | **回退**：top_k / seed / frequency_penalty / presence_penalty / max_completion_tokens / n / stop / response_format / logprobs / top_logprobs / user / 思考 / 额外字段 / 渠道思考等级 / API 密钥 共 15 项消失 |
| 2 | 参数校验 | validateChatParams 覆盖 14 类规则（lib/playground.ts:919-993） | readChatParams 只校验 temperature / top_p / max_tokens（pages/playground.tsx:76-104） | **回退**，且规则冲突：新仓 top_p 拒绝 0（:89-90），面板文案却写「0–1」（params-panel.tsx:140）；旧仓 0 合法（lib/playground.ts:938-940） |
| 3 | 参数文案单一来源 | PARAM_HINTS 20 条 + Tooltip（lib/playground.ts:851-883；chat-params-panel.tsx:89-119） | 4 条硬编码 Hint（params-panel.tsx:127、140、155、169）；lib 里 PARAM_HINTS:945 / paramHintText:974 / validateChatParams:1013 / summarizeChatParams:1121 / maxOutputTokensFor:983 **无引用** | **回退 + 死代码**，迁回成本主要是接线 |
| 4 | max_tokens 上限 | 取所选模型 max_output_tokens，未登记回退 32768（lib/playground.ts:886-891；pages/playground.tsx:86-88） | 只校验正整数（pages/playground.tsx:94-101） | **回退** |
| 5 | 参数摘要条 | summarizeChatParams + 流式/非流式后缀（chat-composer.tsx:117-122；lib/playground.ts:1027-1054） | 无 | **回退** |
| 6 | 参数分组折叠 | 4 组 Collapsible，默认全开（chat-params-panel.tsx:210-240） | 单张 Card 平铺（params-panel.tsx:54-62） | **回退** |
| 7 | 思考控件 | 8 档下拉，映射 reasoning_effort / thinking / enable_thinking（chat-params-panel.tsx:524-555；lib/playground.ts:998-1022） | 无 | **回退**（ChatParams 类型还在：lib/playground.ts:202-206） |
| 8 | 额外请求字段透传 | JSON 文本框 + 保留键保护（chat-params-panel.tsx:556-572；lib/playground.ts:176-189、198-210） | 无 | **回退** |
| 9 | 模型搜索 | combobox 前端过滤 name/channel/upstream（model-combobox.tsx:26-215；lib/playground.ts:801-807） | 普通 Select，无搜索（params-panel.tsx:93-111） | **回退** |
| 10 | 模型标签信息 | 直连/自动组合/手动组合 + 渠道名（model-combobox.tsx:26-32；pages/playground.tsx:45-52） | 只有 targetCount（params-panel.tsx:104-107） | **回退** |
| 11 | 可用模型数 | 页头 Badge「N 个可用模型」（pages/playground.tsx:303） | 无 | **回退** |
| 12 | 不可用置灰 | 无（不加 include_disabled，条目直接不下发：lib/playground.ts:726-731） | 无（只列 enabled 的对外模型：lib/playground.ts:438-440） | **两仓都缺**，目录已有 health/visible 字段可接（lib/playground.ts:700-719；lib/playground-model-options.ts:7-10） |
| 13 | 最近使用 | 无 | 无 | **两仓都缺** |
| 14 | 附件 | 多选文件、读文本、文本块拼进正文（pages/playground.tsx:239-253；chat-composer.tsx:186-203；lib/playground.ts:755-760、1060-1067） | 无（composer 只有 textarea 与发送/停止：composer.tsx:16-66） | **回退** |
| 15 | API 密钥覆写 | 密码框 + resolveBearer 回落会话令牌（chat-params-panel.tsx:307-322；lib/playground.ts:414-417） | 无（sendChatStream 签名无 apiKey：lib/playground.ts:591） | **回退** |
| 16 | 非流式请求 | stream:false 真发非流式（lib/playground.ts:419-463） | 只有 SSE：sendChat 只是把流收完（lib/playground.ts:443-454、591-599）；面板「整段返回」只改渲染时机（pages/playground.tsx:279-288） | **回退**（能力语义变了） |
| 17 | 请求编号展示 | 助手气泡 meta 行显示 requestId（message-list.tsx:152） | 数据有（pages/playground.tsx:322），UI 不显示（message-list.tsx:209-214） | **回退** |
| 18 | 「无思考块」提示 | 无 reasoning 时显式标「无思考块」（message-list.tsx:65-75） | 只有 message.reasoning 为真才渲染思考块（message-list.tsx:232-239） | **回退** |
| 19 | 自动滚动到底 | 消息数/末条内容变化即滚到底（message-list.tsx:174-182） | 无 ref、无 effect（message-list.tsx:200-202） | **回退** |
| 20 | 发送快捷键 | Enter 发送、Shift+Enter 换行、输入法合成保护（chat-composer.tsx:107-112） | ⌘/Ctrl+Enter 发送、Esc 停止、显示字数（composer.tsx:31-51） | **变更**（需产品确认） |
| 21 | 成本兜底 | 有 token 但成本 0 →「未配置单价」（lib/format.ts:47-62；message-list.tsx:41） | 只有 costMicro 是 number 才显示，无兜底（message-list.tsx:169） | **回退** |
| 22 | 计费币种/口径 | USD 小数（costUsd） | 账本微单位 + fmtCny（pages/playground.tsx:107-120；message-list.tsx:169-170） | **口径迁移**，需与定价/币种层对齐 |
| 23 | 多会话 | 无（单键单会话：lib/playground.ts:750） | 有：12 个会话上限、按 updatedAt 排序落盘（components/playground/sessions.ts:9-26、99-116） | **新仓新增** |
| 24 | 重命名 / 删除 / 清空 | 只有整段清除（pages/playground.tsx:280-286、352-360） | 重命名（pages/playground.tsx:409-415）、删除（:417-432）、清空当前会话（:434-442）、行内确认（session-list.tsx:92-169、176-208） | **新仓新增** |
| 25 | 导出 / 导入 | 无 | 无 | **两仓都缺**（新仓落盘形状见 sessions.ts:99-116） |
| 26 | 消息渲染 | 纯文本 whitespace-pre-wrap（message-list.tsx:121-133） | 简版 markdown + 代码块 + 复制 + 重新生成（message-list.tsx:139-159、215-228） | **新仓新增** |
| 27 | Mock 演示 | 无 | VITE_MOCK 演示模型与徽标（lib/playground.ts:12-17、428-431；params-panel.tsx:57） | **新仓新增** |
| 28 | 落盘策略 | 同步写、流式中跳过（pages/playground.tsx:79-84） | 350ms 去抖（pages/playground.tsx:162-166） | **新仓改进** |

回退小计：**18 项功能回退 / 3 项两仓都缺 / 1 项行为变更 / 1 项口径需对齐 / 4 项新仓新增 / 1 项新仓改进**。

### 6.2 可直接复用的资产

- 参数定义、校验、映射、摘要、上限计算**已整段搬进新仓 lib/playground.ts**：ChatParams:187-209、parseExtraFields:218-230、PARAM_HINTS:945-969、paramHintText:974-977、maxOutputTokensFor:983-985、parseStopSequences:998-1003、validateChatParams:1013-、summarizeChatParams:1121、chatParamsFromInput:1090、buildUserContent:1154、toRequestMessages:1167；ThinkingMode 仍定义在 :130-138。
- 旧仓的 UI 骨架可直接参考：ParamLabel + Tooltip + sr-only 说明副本（chat-params-panel.tsx:89-119）、NumberField / ToggleField / ReadOnlyValue（:132-208）、ParamGroup（:218-240）、combobox 键盘与浮层（model-combobox.tsx:122-164、207-256）。
- 旧仓的「说明唯一来源 + 控件只排版」是这次迁移最值得保留的约定（lib/playground.ts:847-850 的注释即约束）。

### 6.3 建议优先级（供上游决策，不含实现）

- **P0（直接影响可用性）**：参数面板补回输出/高级项（#1）、校验接线（#2/#3/#4）、模型搜索（#9）、自动滚动（#19）、请求编号（#17）。
- **P1（对等旧仓能力）**：思考控件与额外字段透传（#7/#8）、参数摘要条（#5）、附件（#14）、API 密钥（#15）、非流式请求（#16）、无思考块提示（#18）、成本兜底（#21）。
- **P2（旧仓也没有，属增量）**：不可用置灰（#12）、最近使用（#13）、导出/导入（#25）。

## 7. 未覆盖与假设

- 未做浏览器实测：hover 文案的实际提示延迟（TooltipProvider delayDuration=0，chat-params-panel.tsx:278）、浮层翻转阈值 200px（model-combobox.tsx:106）均为静态读数。
- 未读后端：/api/catalog 的过滤行为只依据前端默认参数（lib/playground.ts:726-731）与 ssot（docs/ssot.md:549）推断。
- 未审 ADR 原文（docs/ssot.md:641 起的 ADR 索引），ADR-050 / ADR-067 / ADR-070 的结论只按 ssot 转述。
- 新仓的 pages 目录里是否存在第二个试验页入口（路由别名）未逐一核对；本文只按 pages/playground.tsx 这一份实现判断。
- 旧仓「单会话」结论基于 components/playground 无 session 相关文件、history-store 只有单键读写；若仓库另有未纳入 playground 目录的会话实现，本文未覆盖。
