# 旧仓渠道 / 模型 / 价目管理盘点（对照 slipstream phase2）

> 只读盘点。源：`llmapi/web/src` + `llmapi/docs/ssot.md` + `llmapi/docs/GLOSSARY.md`。
> 行号取本轮实测，路径一律相对工作区。
> 对照目标：`slipstream/web/src/pages/{upstreams,upstream_detail,upstream_models,public_models,upstream_prices,downstream_prices,availability}.tsx`。
>
> 一句话结论：旧仓是**一张渠道表 + 渠道内嵌模型表 + 裸名组合**的三段式，价格是渠道模型的四个单价列、无版本无币种；新仓换成**厂商 / 上游 / 上游模型 / 对外模型 / 目标 / 价目版本**六段式，账务与版本化强于旧仓，但**运营侧的探测、多密钥、发现模型、批量、冷却排期**几乎全部丢失。

---

## 0. 心智模型（先对齐，后面才不会误读字段）

旧仓只有三个可编辑实体和一条派生链（`llmapi/docs/GLOSSARY.md:17-40`、`llmapi/docs/ssot.md:105-126`）：

| 实体 | 表 | 谁引用它 | 关键口径 |
|---|---|---|---|
| 渠道 Channel | `channels` | 渠道模型 | 地址 + 多密钥 + 协议/鉴权 + 优先级 + 备注 + 改写规则 |
| 渠道模型 Channel Model | `channel_models` | 手动组合成员 / 自动组合 / 直连名 | 「某渠道 + 某上游模型」这条**绑定**，带一个对外 `call_model` |
| 组合 Combo（手动） | `combos` + `combo_targets` | 裸名寻址 | 成员 = 渠道模型 或 子组合，最多 3 层 |

派生链，不是表：

- **自动组合**（`origin=auto`）没有成员表，由各渠道**启用的**、同名且不含 `/` 的 `call_model` 查询期聚合（`llmapi/docs/GLOSSARY.md:36`、`llmapi/docs/ssot.md:112`）。
- **目录条目**（`kind ∈ {direct, combo}`）是查询期拼出来的，前端在 `llmapi/web/src/lib/catalog.ts:44-69` 里规范化。
- **可见状态 / 可用性**不落库，由 `enabled` + `banned_until` + 健康轴实时推导（`llmapi/docs/GLOSSARY.md:58-63`）。

三处最容易踩的语义，本轮必须先记住，否则新旧对照会全错：

1. **priority 越大越先调用**（2026-11-15 翻转，`llmapi/docs/GLOSSARY.md:46`、`llmapi/docs/ssot.md:114`）。新仓 `slipstream/web/src/pages/public_models.tsx:178` 写的是「failover 填 priority（层级，小优先）」——**方向相反**，这是要拍板的第一件事。
2. **组合内不设 `weight`**，统一用目标 `priority`；同层等概率随机（`llmapi/docs/ssot.md:239`）。新仓 `weight` 是新增能力，不是旧仓迁移项。
3. **措施只有两种：封禁 / 冷却**；判据唯一 = `banned_until` 有无。封禁永久、只能人工解除；冷却到期自愈（`llmapi/docs/ssot.md:149-154`）。

---

## 1. 渠道（上游）创建 / 编辑

### 1.1 三条入口，三种能力边界

旧仓的渠道不是「一个页面搞定」，而是**新建对话框**（字段子集）+ **编辑页四个 tab**（全量）+ **列表页行内快捷操作**（高频动作）三段，分工是刻意的：

| 入口 | 文件 | 能做什么 | 刻意不做 |
|---|---|---|---|
| 新建对话框 | `llmapi/web/src/components/channels/channel-form-dialog.tsx:91-338` | 名称、地址、slug、协议、单密钥、优先级、启用 | **不收备注、不收改写规则、不支持多密钥**（`:120-140` 的 payload 只有 6 个键） |
| 编辑页 | `llmapi/web/src/pages/channel-detail.tsx:291-1155` | 全量字段 + 多密钥 + 测试 + 获取模型 + 改写 + 概览 | 未保存前不能进「路由与映射」（`:976-987`） |
| 列表页 | `llmapi/web/src/pages/channels.tsx:101-684` | 搜索/状态筛选/改优先级/启停/删除/批量 | 不改地址与密钥 |

新建对话框的措辞点明了这条边界（`llmapi/web/src/components/channels/channel-form-dialog.tsx:153-155`）：

> 先保存连接配置，再在编辑页获取上游模型并勾选导入。保存不会触发任何上游测试。

### 1.2 渠道全部字段（以后端契约为准）

```ts
// llmapi/web/src/lib/channels.ts:53-83
interface Channel {
  id; slug; name; note;
  connection_url; endpoint_preview; models_endpoint_preview;
  api_key_set; api_key_masked; api_key_count; api_key_masks; api_keys: ChannelKey[];
  protocol: "openai_chat" | "anthropic_messages" | "gemini";
  protocol_source: string;          // "auto" 表示自动探测得出
  auth_style: string;               // bearer | api-key | x-api-key | query-key
  priority: number; enabled: boolean;
  connection_status: "ok"|"timeout"|"error"|"unknown";
  connection_latency_ms; connection_message; connection_tested_at;
  last_model_probe_latency_ms; last_model_probe_at; last_model_probe_status;
  override_sections: RewriteSection[];   // 列表页「参数覆盖」图标的数据源
  rewrite_rules: RewriteRules;
  model_count; created_at; updated_at;
}
```

写入面只有 8 个键（`llmapi/web/src/lib/channels.ts:109-121`）：`slug?`、`name`、`note?`、`connection_url`、`api_key?`、`api_keys?: {label?,api_key}[]`、`protocol?`（缺省 = 自动）、`priority`、`enabled`、`rewrite_rules?`。

逐字段的来源与约束：

| 字段 | 控件 | 约束（前端） | 行为要点 |
|---|---|---|---|
| 名称 name | Input | trim 非空、≤128（`channel-form-dialog.tsx:46`、`channel-detail.tsx:404-405`） | 仅展示 |
| 连接地址 connection_url | Input（等宽） | 必须 `^https?://`；末尾 `#` = 精确端点不拼路径（`:47-54`、`llmapi/web/src/lib/channels.ts:367-389`） | 实时算 `chatUrlFor` / `modelsUrlFor` 预览「最终请求地址」 |
| 渠道标识 slug | Input（等宽） | `/^[A-Za-z][A-Za-z0-9_-]{0,63}$/`，可空 | 空则按 `slugFromUrl` 从地址推导（`channels.ts:391-416`：host 去点→中划线、非 80/443 端口作后缀、路径作后缀、截 64；不起字符则补 `ch-`） |
| 协议 protocol | Select | `auto` + 3 个值 | `auto` 只在 `isNew || protocol_source === "auto"` 时可选（`channel-detail.tsx:599,833`）——手工钉过的协议不给退回自动 |
| 渠道密钥 api_key / api_keys | password Input + 密钥面板 | 见 §1.4 | 只写不读，永不回显明文 |
| 优先级 priority | number Input | 整数 1–1000（`channel-form-dialog.tsx:65-69`、`channel-detail.tsx:416-418`） | 「数值越大越先调用；自动组合按渠道优先级分层，同层等概率随机」 |
| 启用 enabled | Checkbox（新建）/ Toggle（编辑页两处） | bool | 编辑页直接 PATCH，不等保存（`channel-detail.tsx:342-351`） |
| 备注 note | Textarea | ≤500，带 `N / 500` 计数（`channel-detail.tsx:1026-1036`） | 「备注用于列表识别，不发送给上游」 |
| 改写规则 rewrite_rules | 独立 tab 的编辑器 | 见 §1.6 | 与草稿一起提交（`channel-detail.tsx:497`） |

只读回显字段（不进表单）：`auth_style`（「鉴权方式」，`channel-detail.tsx:923-927`）、`protocol + protocol_source`（「已识别协议 … （自动）/（手动）」，`:928-934`）、`connection_status/latency/message/tested_at`、`model_count`、`created_at/updated_at`（`:1055-1076`）。

### 1.3 编辑页：四个 tab 的职责

```ts
// llmapi/web/src/pages/channel-detail.tsx:70-77
type TabKey = "connection" | "routing" | "rewrite" | "settings";
const TABS = [
  { key: "connection", label: "连接与模型", icon: Cable },
  { key: "routing",    label: "路由与映射", icon: Blocks },
  { key: "rewrite",    label: "请求与响应", icon: ScrollText },
  { key: "settings",   label: "其他设置",   icon: Settings2 },
];
```

- **连接与模型**（`:717-963`）：左卡片 = 名称/标识/地址/最终地址预览/密钥面板/协议/优先级；右列 = 「连接状态」卡片（状态、耗时、最近测试、message、模型预览前 8 个、鉴权方式、协议来源）+「模型」卡片（`model_count` + 「前往路由与映射」按钮）。
- **路由与映射**（`:965-988`）：挂 `ChannelModelsPanel`；未保存时是空态卡片「先保存渠道，再配置路由」+ 创建按钮。
- **请求与响应**（`:990-1012`）：挂 `RewriteRulesEditor`，同样要求先保存。
- **其他设置**（`:1014-1089`）：备注 + 启用开关 + 「渠道信息」`dl`（ID/连接状态/最近结果/创建时间/更新时间）+ 「运行概览」（`ChannelOverview`，`:161-289`：近 7 天请求数、错误率、P95 总耗时、成本，请求趋势柱图，最近探测，最近 6 条请求）。

tab 可由 URL 指定：`?tab=routing`（`:298-302`），列表页的「测试连接」图标就是跳到这个 tab（`channels.tsx:550`）。

### 1.4 多密钥（20 把上限、请求级选键、无「轮换」按钮）

文件：`llmapi/web/src/components/channels/channel-keys-panel.tsx`。

- 上限常量 `MAX_CHANNEL_KEYS = 20`（`:27`）；超限时添加与批量都被拦（`:277-279`、`:220-222`）。
- 未保存的新渠道：密钥先落在 `pendingKeys`（`PipelineChannelKey {local_id,label,masked,api_key}`，`:29-34`），随创建 payload 一起提交（`channel-detail.tsx:498-505`），行上标「待保存」（`:451-453`）。
- 已保存渠道：`POST /api/channels/{id}/keys`（`llmapi/web/src/lib/channels.ts:252-260`）。
- 每条密钥可**改备注**（`PATCH`，`lib/channels.ts:271-280`）；后端没实现时页面给的是明确文案而不是静默失败：`channel-keys-panel.tsx:140-145` 判定 404 → 「当前后端尚未支持修改备注，请升级后端后再试。」
- 删除确认写清了后果（`:617`）：「删除后该密钥立即停止参与轮换。**若这是最后一个密钥，渠道将以无密钥方式请求上游**。」
- 重复密钥不静默覆盖：`409`/`CONFLICT` → 「该密钥已存在，未重复添加。」（`:52-59`）。
- **批量模式**（`:468-541`）：Textarea 一行一把 → 逐条 `testChannelDraft` 预检（复用当前表单的地址/协议/改写，无需先保存，`:241-245`）→ 全通过则自动保存；有失败则弹确认「清除检测失败的密钥？」，文案给失败/通过数量，通过项仍会保存（`:593-607`）。保存时备注自动写成「批次 N」（`:166`）。
- 底部说明钉住了选择语义（`:588-590`）：「最多 20 个。只写入、不以明文返回；调用时**按请求编号分散使用**，悬停列表可看到尾部 4 位。」

对应的后端口径（`llmapi/docs/ssot.md:340-342`、`llmapi/docs/GLOSSARY.md:22`）：

- 主密钥 = `channels.api_key_enc` **指向的那一行**，不是「排序第一条」——Fernet 非确定性加密，同毫秒创建的多密钥排序随机，识别主密钥必须解密比对明文。
- 正式请求按 `sha256(request_id)` 确定性选键、重试保持同一 key；**探测固定用首密钥**。
- 已知副作用（术语表专门记了坑）：厂商前缀缓存按账号隔离，**给一个渠道加第二把密钥会当场把缓存打散**，所以「轮换」在旧仓不是按钮，而是「加键前必须先有会话亲和」。

### 1.5 连通测试与「发现模型」

**测试连接**（连接级，不写库的草稿预检）：

- 编辑页右上角按钮（`channel-detail.tsx:662-674`），调 `POST /api/channels/test-connection`（`lib/channels.ts:239-246`）——传的是**页面当前值**：`channel_id?`、`connection_url`、`api_key`（取第一条待保存密钥）、`protocol?`、`rewrite_rules`（`channel-detail.tsx:423-437`）。
- 结果卡片显示状态/耗时/「刚刚（未保存）」/message/模型预览前 8 个（`:880-912`），并额外提示「这是未保存草稿的测试结果，渠道卡片上的状态不会改变」（`:914-918`）。
- **无密钥先拦一道**（`:451-458`、`:1093-1127`）：AlertDialog 标题「这个渠道还没有密钥」，正文点明「不带密钥的请求会被直接拒绝（HTTP 401）——**那不是密钥失效，而是这次请求根本没有带上密钥**」，两个动作：「仍然匿名尝试」/「去添加密钥」（后者切回连接 tab 并聚焦密钥框，`:477-485`）。

**发现模型**（`llmapi/web/src/components/channels/discover-models-dialog.tsx`）：

- 打开即请求 `POST /api/channels/discover-models`（`lib/channels.ts:289-296`），入参与测试连接同构，可用**未保存的草稿**发起（`channel-detail.tsx:1135-1140`）。
- 结果三态：`ok` / `timeout`(warning) / `error`(destructive)，失败也给出 HTTP 码与耗时（`:302-309`）。
- 列表能力：按模型名搜索、**按供应商分组**（取模型名第一个 `/` 前缀，无前缀归「其他」，`:56-61,173-186`）、宽屏两列独立滚动（`:68-85,189-192,430-437`）、全选未添加（`:367-376`）、已添加行禁用并标「已添加」（`:231-258`）、默认自动勾选全部未添加（`:194-198`）。
- 写入：`POST /api/channels/{id}/models/bulk`（`lib/channels.ts:298-306`），返回 `{created, skipped, errors[], items[]}`。未保存渠道会**先创建渠道再写入**，并且失败文案区分两种阶段（`:125-131`）：「渠道已创建，但添加模型失败」/「添加模型失败」+「已勾选的模型已保留，可重试」。
- 成功回调切到 routing tab 并提示「新增 N 个，跳过 M 个重复项」（`channel-detail.tsx:1141-1151`）。

### 1.6 改写规则（渠道级，四作用域）

类型在 `llmapi/web/src/lib/channels.ts:8-51`：`RewriteSection = request_headers | request_body | response_headers | response_body`；`HeaderMode = set|delete|rename`；`BodyMode = create|update|delete|copy|prepend|append|regex_replace|to_upper|to_lower`；`ConditionMode = full|regex|gt|gte|lt|lte`；`RewriteRule` 还有 `conditions[]`、`logic: "AND"|"OR"`、`keep_origin`、以及**只给编辑器看的** `note`（`:37-38` 注释写明「ignored by the rewrite engine」）。

编辑器形态与契约见 `llmapi/docs/ssot.md:292-306`：可视化规则卡片 + 高级 JSON + 四作用域 tab + 拖拽排序 + **先「试运行」生成 diff 再「运行」应用**；试运行端点 `POST /api/channels/{id}/rewrite-preview`（`lib/channels.ts:324-337`，返回 `{section,before,after,diff[],warnings,skipped,rule_results[]}`）。列表页用 `override_sections` 在协议徽标后挂一个滑块图标，tooltip 列出被覆盖的作用域（`channels.tsx:435-458`）。

保护面（`ssot.md:303-305`）：凭据头、传输层头，以及出站侧的 `content-type/content-length/host/x-request-id` **禁止被渠道规则改写**；流式体改写会跳过并在日志写 `rewrite_skipped=stream`。

### 1.7 启停、删除保护、批量与列表页细节

列表页 `llmapi/web/src/pages/channels.tsx`：

- 筛选：关键词（名称/标识/地址，`:265-272`）+ 状态 Select（全部/正常运行/连接超时/探测失败/未知状态，`:69-75,273-287`），搜索用防抖并区分「搜索中…」（`:108-109,289-291`）。
- 表格列（`:359-378`）：勾选 / 渠道（名称 + 已封禁徽标 + slug + 备注）/ 类型（协议徽标 + 覆盖图标）/ 密钥数量（数字徽标，tooltip 列全部掩码，`:77-99`）/ 模型（`model_count`）/ **优先级（行内 number 输入）** / 探测记录（状态徽标 + 耗时 + 时间）/ 快捷操作。
- 优先级行内编辑（`:470-504`）：blur 时 `clamp(1,1000)`，值没变不请求；Enter 触发 blur；tooltip「数值越大越先调用；自动组合按层等概率随机分流」。
- 快捷操作（`:518-581`）：启停（`aria-pressed`，`:529-534`）、打开「路由与映射」（`:550`）、编辑、删除。
- **删除保护**（`:604-606`）：「渠道下的模型会一并删除；**如果任一模型已被组合引用，删除会被拒绝**，请先解除组合引用。」错误直接渲染在对话框里（`:607-611`），不吞。
- **批量**（`llmapi/web/src/components/channels/channel-batch-toolbar.tsx:6-102`）：启用 / 封禁 / 测速 / 删除 / 取消选择，明说「逐个执行，失败项会单独提示」。实现是串行 for 循环 + 逐条 try/catch（`channels.tsx:185-238`），测速取该渠道**第一个模型**做 `shallow` 探测，没模型直接记为失败「（未配置模型）」；结束后按成功/失败分别 toast，失败超过 3 条只列前 3 个（`:228-237`）。批量删除有独立确认对话框（`:638-681`）。

---

## 2. 渠道模型（上游模型）

### 2.1 字段全表

```ts
// llmapi/web/src/lib/channel-models.ts:133-166
interface ChannelModel {
  id; channel_id; upstream_model; call_model;
  parameters: ModelParameters;                 // 见下
  input_price_per_1m; output_price_per_1m;
  cache_read_price_per_1m: number | null;      // 留空 = 按输入价
  cache_write_price_per_1m: number | null;     // 留空 = 暂不计价
  enabled: boolean;
  banned_until?: number | null;                // 人工冷却到期；null/缺省 = 永久封禁
  health_status: "normal"|"open"|"half_open"|"fault";
  visible_status: "normal"|"open"|"half_open"|"fault"|"disabled";
  consecutive_failures; consecutive_trip_count; escalation_trip_count;
  opened_at; cooldown_until; fault_until; next_retry_at;
  cooldown: BreakerConfig;                     // 熔断参数随行返回
  schedule: ChannelSchedule;                   // v1 segments 或 v2 rules
  probe_status: "ok"|"timeout"|"error"|"unknown";
  probe_latency_ms; probe_message; probed_at; probe_default: boolean;
  model_type: ModelType; model_type_source: "default"|"upstream"|"manual";
  created_at; updated_at;
}

// llmapi/web/src/lib/channel-models.ts:58-72
interface ModelParameters {
  max_input_tokens; max_output_tokens; reasoning_level: string;
  input_types: ("text"|"image"|"audio"|"video"|"file")[];
  output_types: ("text"|"image"|"audio"|"embedding")[];
  tool_call?: boolean; reasoning?: boolean; attachment?: boolean; structured_output?: boolean;
}

// llmapi/web/src/lib/channel-models.ts:9-17 —— 每行都能读到的熔断参数
interface BreakerConfig {
  failure_threshold; cooldown_s; rate_limit_cooldown_s;
  half_open_max; escalate_mode: "never"|"after_n"|"immediate";
  escalate_after; fault_cooldown_s;
}
```

写入面 `ChannelModelInput`（`:173-185`）：`upstream_model`、`call_model?`、`parameters`、4 个价格、`enabled`、`model_type?: ModelType | "auto"`、`schedule?: ScheduleDocument`。注意 `auto` 是**指令不是存储值**（`llmapi/docs/ssot.md:191`）。

### 2.2 表单：字段分组与每一条约束

文件 `llmapi/web/src/components/channels/channel-model-form-dialog.tsx`（882 行，单对话框，无 tab）。

| 分组 | 字段 | 控件 | 约束 / 默认 |
|---|---|---|---|
| 映射 | 上游模型 upstream_model | Input 等宽 | 必填；`/^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,127}$/`（`:66,139-143`） |
| 映射 | 调用模型 call_model | Input 等宽 | 可空；空则保存时回填为上游模型名（`:379`）；同样正则、≤128 |
| 映射 | 模型类型 model_type | Select | `auto` + 7 类；**编辑时默认值取「仅当 `model_type_source==="manual"` 才回显具体类型」**，否则显示 auto（`:189-191`） |
| 价格 | 输入单价 / 输出单价 | number，`step=0.0001` | ≥0（`:150-155`） |
| 价格 | 缓存读取单价 | number | ≥0 或 null；占位「留空 = 按输入价」（`:583`） |
| 价格 | 缓存写入单价 | number | ≥0 或 null；占位「留空 = 暂不计价」（`:605`） |
| 参数 | 最大输入 / 最大输出 | number | 整数 0–100,000,000；**0 = 未声明**（`:117-126`、`:625`） |
| 参数 | 推理等级 reasoning_level | Input | ≤32 字符，自由文本（如 high / medium） |
| 参数 | 输入类型 / 输出类型 | 复选框组（chips） | 各至少选 1（`:128-129`） |
| 参数 | 能力位 ×4 | Checkbox | tool_call / reasoning / attachment / structured_output；**两态**：保存时四个键全量写布尔，取消勾选 = 显式 false（`:371-375`，注释指向 task-153 拍板 A） |
| 排期 | IANA 时区 | 选择器 + 校验 | `isValidTimezone`，非法直接拦（`:349-353`） |
| 排期 | 规则集 | `ScheduleRulesFieldset` | `validateScheduleRules(rules, {allowEmpty:true})`；空 = 全天可用；HH:MM 正则（`:354-362`） |
| 开关 | 启用 enabled | Checkbox | 默认 true |

表单里还有三处「只展示、不落库」的来源提示：`describeFieldSource` 把 models.dev 的 provider 与合并规则挂到每个字段的 `title`（`:424-428`），顶部一行 `describePrefillSource`（`:417-422`），且**编辑已有模型时全部不显示**。

预填机制（ADR-073）值得单独记一笔，因为它决定「保存时提交什么」：

- 新建模型时按 `upstream_model` 防抖 400ms 查 `fetchModelPrefill`（`:250-259`），只读本地快照、不触发刷新、失败静默。
- 只填用户**没动过**的字段：自己维护 `prefillBaselineRef` 基线，因为 react-hook-form 的 `dirtyFields` 会把「我们写进去的默认值」也算 dirty（`:216-220` 注释、`:262-319`）。
- `model_type` 只是**建议**：用户没改过就不提交（`:314-318`、`:386-392`），保留后端自动判定。
- 页面底部「应用默认参数」按钮（`:852-866`）调 `POST /api/channel-models/{id}/adopt-defaults` `{force:true}`，成功后提示「已恢复 N 项为 models.dev 自动值（记得保存）」；未命中时提示「上游模型未命中 models.dev，无可恢复项」（`:334-345`）。

### 2.3 类型与类型来源（两列，必须分开看）

- 类型 7 值（`llmapi/web/src/lib/channel-models.ts:82-90`）：`chat 聊天 / embedding 向量 / rerank 重排 / image_generation 图像生成 / audio_tts 语音合成 / audio_transcription 语音转写 / video 视频`。
- 来源 3 值（`:92-99`）：`default 默认（上游未声明，按聊天处理）/ upstream 上游同步（按模型名自动识别）/ manual 手动（人工指定，覆盖自动识别）`。
- 表格里**类型 + 来源两行一起显示**（`llmapi/web/src/components/channels/channel-models-panel.tsx:399-420`）：类型 chip 的 tone 按「是否 chat」区分（chat 中性、非 chat 主色），来源用一行小字。
- 名字推断刻意保守：只有 `rerank` 家族与 `embedding` 家族能从名字认，其余一律 `chat + default`，因为猜错会把探测发到错误端点（`llmapi/docs/ssot.md:192`）。`/chat/completions` 只接受 chat 类型候选，整轮无 chat 候选直接 400 `NOT_IMPLEMENTED`（`ssot.md:193`）。

### 2.4 渠道模型列表页（渠道详情 → 路由与映射）

文件 `llmapi/web/src/components/channels/channel-models-panel.tsx`。

- 页头（`:241-291`）：「模型映射 + N 个」、探测方式分段控件（`shallow` 模型拉取探测 / `deep` 模型连接探测，`lib/channel-models.ts:470-473`，默认 `deep`）、「全部探测」、「添加模型」。
- 统计条 5 格（`:293-311`）：模型总数 + ok/timeout/error/unknown 四格。
- 表格 7 列（`:350-361`）：默认探测（单选）/ 上游模型 / 调用模型 / 类型 / 模型参数 / 输入·输出单价 / 探测状态 / 操作。
- 行内信息密度：
  - 上游模型行下挂「· 计划 {摘要}」，封禁时再挂「冷却至 …」或「已封禁」（`:381-397`）。
  - 模型参数压缩成两行：`输入 N · 输出 N · 推理 high` + 输入类型 → 输出类型两个 chip（`:67-85`）。
  - 价格列第二行是缓存口径：两个缓存价都为空时显示「缓存按输入价」，否则「缓存读 X / 写 Y」（`:429-434`）。
  - 探测列：状态徽标 + 耗时或「尚未探测」+「最近 {时间}」（`:436-451`）。
- 操作列（`:452-495`）：可用性按钮、单条探测、编辑、删除。
- 页脚说明（`:505-509`）把三类语义钉死：「'未知状态'只表示从未探测，不会因时间自动变化。模型拉取探测只请求 `/models`；模型连接探测在识别协议后发送一次最小 chat，**不触碰熔断计数器**。熔断中的模型会自动冷却恢复，人工封禁的模型需手动启用。'默认探测'每个渠道只有一个，全部探测时会优先探测它。」

### 2.5 可用性：封禁 / 冷却 / 排期 / 复位

旧仓刻意**没有独立的「复位」按钮**，一个按钮按三态推导（`llmapi/web/src/components/models/model-availability.tsx:10-47`）：

```ts
availabilityPlan({enabled, health}) =
  !enabled            → { action:"enable", enabled:true,  reset: isBrokenHealth(health) }
  isBrokenHealth      → { action:"reset",  reset:true }          // 按钮仍显示「启用」
  else                → { action:"ban",    enabled:false, reset:false }
```

- 文案随之变化（`:77-87`）：封禁 → 「封禁后，{subject} 不再参与路由，直到手动启用。」；启用+复位 → 「启用后，{subject} 重新参与路由，并清除其冷却状态。」。
- 面板侧的落地（`channel-models-panel.tsx:174-220`）：`enable` 先 `PATCH {enabled:true}`，需要时再串 `POST /reset`；`ban` 只 `PATCH {enabled:false}`；`reset` 只打 `/reset`。
- 数据面口径：`enabled=false` + `banned_until` 为空 = **封禁**（永久）；`banned_until` 有值 = **冷却**（到期自愈）。封禁条目不进 `/v1/models`、直连 404；冷却条目仍在 `/v1/models`、路由跳过、直连 503（`llmapi/docs/ssot.md:149-154`）。
- 排期 = 冷却的第三种触发源，v2 文档 `{version:2, timezone, rules[]}`，`rules.kind ∈ daily|weekly|monthly`，`end <= start` 表示跨天（`llmapi/web/src/lib/channel-models.ts:290-311,329-351`）；旧 v1 `segments` 只读兼容、写入一律 v2（`:19-33,388-418`）。
- 批量（目录页用）：`applyModelAvailabilityBulk`（`llmapi/web/src/lib/catalog.ts:166-203`）优先 `PATCH /api/channel-models/batch`（`op ∈ ban|unban|cooldown|schedule`，单请求 ≤200 条 `BATCH_LIMIT`，`lib/channel-models.ts:454-468`），端点缺失（404/405）时**退化串行单条 PATCH**；但 `op=schedule` 明确拒绝退化并抛 `BATCH_ENDPOINT_MISSING`——「排期只有批量端点这一种写法：退化到单条 PATCH 会被当成'永久封禁'，端点缺失时宁可报错，也不静默把模型停掉」（`catalog.ts:180-187`）。这个「宁可报错不静默降级」的取舍，新仓值得照抄。

---

## 3. 公开模型 / 组合编排

### 3.1 三种条目，一页管理

`/catalog`（`llmapi/web/src/pages/models.tsx`，1468 行）是唯一入口，旧 `/combos` 书签重定向过来（`:189 CombosRedirect`）。条目口径由 ADR-067 钉死（`llmapi/web/src/lib/catalog.ts:12-28`）：`kind ∈ {direct, combo}`、`combo.origin ∈ {manual, auto}`、定时封禁 = `enabled=false + banned_until` **读取时惰性判活、不引定时器**。

界面上的三种文案对两个 kind（`llmapi/docs/GLOSSARY.md:127`）：

| 文案 | kind | origin | 能做什么 |
|---|---|---|---|
| 直连 | direct | — | 复制调用名、加入组合、启用/封禁/冷却 |
| 手动组合 | combo | manual | 编辑、删除 |
| 自动组合 | combo | auto | **只读**，标「只读 · 实时派生」 |

页面结构（`models.tsx` 已核实锚点）：kind 筛选 `:93`、协议筛选 `:101`、每页 25 `:108`、按类型筛选 `:842`、协议筛选 `:860`、搜索 `:880`、全选当前页 `:957`、按名称排序 `:975`、按状态排序 `:1009`。行内价格 `:1094-1101`（直连显示「入 X / 出 Y / 缓存 Z」`:1461-1465`；组合显示成员区间 + 「按实际选中成员计费，不合成单一价格」）。

对话框矩阵（`:1335-1444`）：`ConfirmDialog` ×3（删除/启停类）、`CooldownDialog`、`ScheduleEditorDialog`、`ChannelModelFormDialog`（复用渠道模型表单）、`AddToComboDialog`、`ComboEditorDialog`。

批量工具条（`llmapi/web/src/components/models/bulk-action-bar.tsx:59-138`）：启用 / 封禁 / 冷却 / 排期 / 加入组合 / 清除，吸底浮动、`createPortal` 到 body（`:75-77` 注释解释了为什么必须挂 body：外层 `animate-fade-up` 的 transform 会让 `fixed` 失去视口定位并被滚动裁剪）。两条禁用规则带 tooltip 解释：「组合条目不支持定时：请只选直连模型」与「自动组合由成员派生，不能单独启停」（`:72-73`）。

### 3.2 组合编辑器：字段与编排语义

```ts
// llmapi/web/src/lib/combos.ts:39-56
interface Combo {
  id; name; description; enabled;
  max_attempts: number;                     // 完整轮数，不是候选数
  route_strategy?: "" | RouteStrategy;      // 空 = 跟随全局
  route_window_minutes?: number;            // 观察窗口覆盖
  failover_rules: { rules: ComboFailoverRule[]; default_action: "next"|"stop" };
  member_count; available_count; depth; max_depth; callable;
  created_at; updated_at; members: ComboMember[];
}

// :28-37 —— 切换规则
interface ComboFailoverRule { status: Array<number|string>; body_regex: string|null; action: "next"|"stop" }
```

成员 `ComboMember`（`:9-26`）：`target_type: "channel_model"|"child_combo"`、`priority`、`enabled`、`available`（运行时算出的可用性回显）、`channel_model_id`、`child_combo_id`、`channel_id/slug/name`、`call_model`、`upstream_model`、`child_combo_name/enabled`、`protocol`。

编辑器（`llmapi/web/src/components/combos/combo-editor-dialog.tsx`，1098 行）：

| 区域 | 锚点 | 说明 |
|---|---|---|
| 名称 | `:503` | `/^[A-Za-z][A-Za-z0-9_-]{0,63}$/`，与渠道 slug 共用命名空间（`:75`） |
| 路由策略覆盖 | `:586` | 空 = 跟随全局；同层成员的排序规则（uniform/stable/cost/latency，`llmapi/docs/GLOSSARY.md:161`） |
| 观察窗口覆盖 | `:610`、`:624` | 窗口 15/30/60/自定义（15–1440，默认 30）；「组合自定义窗口（分钟）」 |
| 切换规则 | `:640` | 状态码 + body 正则 + 动作；`default_action` 默认 `next`（`:187`）；动作文案映射在 `:78-82` |
| 已选成员 | `:770`、`:797` | 搜索 + 列表（`role="list"`） |
| 待选成员 | `:948`、`:995` | 两个 tab：渠道模型 / 子组合（`:122`） |

编排语义（`llmapi/docs/ssot.md:239-244`）：嵌套 ≤3 层、保存时做**环检测 + 深度校验 + 重复目标校验**；不同 priority 从大到小顺序调用（前层全失败才进下层），相同 priority 同层等概率随机；`max_attempts` 是**完整轮数**；顶层组合才拥有 `failover_rules` 与轮数，子组合只贡献成员与 priority。

纯函数的取舍都写在注释里，可直接搬：

- `sortMembersByPriority` 降序（`llmapi/web/src/lib/combos.ts:108-111`）：「数值越大越先调用，P40 排在 P1 前面」。
- `nextMemberPriority`（`llmapi/web/src/lib/combos-editor.ts:58-69`）：新成员并入当前**最低层**（已有最小值），空则 1。注释给了理由：「priority 有 ge=1 下限，min-1 会非法；全员 +1 会改写用户手调过的数字」。
- `descendantIds`（`:86-105`）：rootId 也算已访问，否则 A→B→A 会把 root 自己当后代加回来。
- `buildCandidates`（`:107-146`）：**被封禁的渠道模型仍留在候选里，只标「已封禁」**——「封禁只能手动解除，组合是长期配置」；子组合被封禁则直接 `blocked`。
- `parseStatuses`（`:160-167`）：三位数字转 number，其余保留字符串（支持 `rate_limit` 这类非数字状态）。

### 3.3 组合上的可用性边界

组合只有**启用 / 封禁**一个开关，没有冷却、没有定时（`llmapi/docs/ssot.md:123`、`llmapi/docs/GLOSSARY.md:67`）。所以批量工具条上「冷却 / 排期」对组合禁用（`bulk-action-bar.tsx:72`），自动组合连启用/封禁都不给（`:73`，因为可见性由成员实时派生）。

组合参数是**聚合**而不是合成（`llmapi/web/src/lib/combo-params.ts:12-19`）：上限取成员最大值（「厂商事实，没有人会把上限调大」）、能力位与模态取并集（「不广告 ≠ 没有」）、价格列区间并注明「按实际选中成员计费」——**不合成单一价格**。tooltip 逐行文案在 `:121-143`。

---

## 4. 价目管理

### 4.1 旧仓的答案：没有价目表，只有渠道模型的四个单价列

这是本轮最干脆的一条结论，可以直接回答「成本价与售价是否同页」：

- 价格只存在于 `channel_models`：`input_price_per_1m` / `output_price_per_1m` / `cache_read_price_per_1m` / `cache_write_price_per_1m`（`llmapi/web/src/lib/channel-models.ts:139-142`）。**没有** `sell_price`、`cost_price`、`markup`、`补价` 任何字段（全仓 `web/src` 搜 `售价|成本价|sell_price|markup|补价` 命中 0）。
- 所以「成本价 vs 售价」在旧仓**无从谈起**：只有一套单价，它同时是**成本口径**（`request_logs.cost_usd` 由它算出来）与**展示口径**（目录行、组合区间）。`llmapi/web/src/lib/format.ts:43-60` 的 `isCostUnconfigured` 说明这个耦合：「有词元消耗但成本为 0 ⇒ 判为未配置单价」，展示成「未配置单价」而不是误导性的 `$0.00`。
- 与「同页」相关的事实：单价与模型参数、启用、排期**在同一个对话框里**（`llmapi/web/src/components/channels/channel-model-form-dialog.tsx:535-616`，四个价格输入与上游/调用名同在第一个 `grid sm:grid-cols-2` 里）。旧仓没有「模型详情页」「价格页」这类独立路由。
- 没有生效时间、没有版本、没有币种、没有汇率、没有加价/补价、没有微单位整数——全部为 `number`（`step=0.0001`，USD 语义由 `cost_usd` 暗示）。单价改动即时生效，历史成本**不重算**（因为是列值，日志里的 `cost_usd` 是当时算好的快照——这一点与「改价不重算历史账」的目标一致，但机制是巧合而非设计：没有 `price_version_id` 可用）。
- 唯一带「版本」的东西是 **models.dev 快照的 `rule_version`**（`llmapi/docs/ssot.md:395` 的 `model_defaults` 表），那是默认参数来源，不是计费。

### 4.2 小结（供决策）

| 问题 | 旧仓 | 新仓 |
|---|---|---|
| 成本价与售价是否同页 | 只有一套价，无所谓同页 | 拆成「上游价目（成本账）」与「对外价目（营收账）」两页 |
| 字段 | 4 个单价 + 缓存留空语义 | 计费项 item、单价（整数微单位）、币种、生效时间、版本、mode(markup/fixed) |
| 生效时间 | 无 | `effective_from` |
| 版本 | 无 | `version`，改价走「新建版本」不原地改 |
| 外币汇率 | 无 | 有 `currency` 列（汇率本身未见实现） |
| 补价 / 加价 | 无 | `mode=markup`，万分数（12000 = 1.2 倍） |

换句话说：**旧仓在价目维度上是「够用即止」，新仓是从零设计的账务模型。这一块不是「旧仓有、新仓缺」，而是反过来**——见 §5 的分类。

---

## 5. 与新仓的差距（逐项 file:line）

### 5.0 先对齐实体映射，否则「缺失」会算错

| 旧仓 | 新仓 | 关系 |
|---|---|---|
| 渠道 Channel（`channels`） | 上游 Upstream（`slipstream/web/src/pages/upstreams.tsx:17-21` 的 `Upstream`） | 同层，新仓多一个「厂商 Vendor」父级 |
| 渠道模型 Channel Model（`channel_models`） | 上游模型 UpstreamModel（`slipstream/web/src/pages/upstream_models.tsx:35-42`） | **不等价**：新仓的 UpstreamModel 没有「对外调用名」这一层 |
| 手动组合 Combo | 对外模型 PublicModel + 路由目标 ModelTarget | 拆成两层：模式在模型上，成员在目标上 |
| 自动组合 Combo(origin=auto) | **无对应物** | 新仓没有「裸名查询期派生」这个概念 |
| 渠道模型的两个单价列 | 上游价目 UpstreamPrice（版本化） | 成本侧升级 |
| （无） | 对外价目 ChargePrice | 营收侧净增 |
| 模型表单里的排期 + 目录页批量冷却 | 可用性规则 AvailabilityRule | 独立实体，跨 4 种 scope |

### 5.1 渠道（上游）：14 项中 9 项缺失、5 项变形

| # | 能力 | 旧仓 | 新仓现状（file:line） | 判定 |
|---|---|---|---|---|
| A1 | 备注 note（≤500，仅列表识别） | `llmapi/web/src/pages/channel-detail.tsx:1021-1037` | `slipstream/web/src/pages/upstreams.tsx:24-112` 表单无 note；`slipstream/web/src/pages/upstream_detail.tsx:38-65` 信息卡无 note | **缺失** |
| A2 | 渠道标识 slug（可读、可改、唯一、寻址前缀） | `llmapi/web/src/components/channels/channel-form-dialog.tsx:217-234`、`llmapi/web/src/pages/channels.tsx:418-421` | `slipstream/web/src/pages/upstreams.tsx:57` 明说「名称由厂商 slug 自动编号（{vendor_slug}-NN）」且编辑不可改（`:55-58`） | **语义不同**：无独立 slug，也就没有 `slug/call_model` 直连寻址 |
| A3 | 优先级 priority（1–1000，行内可改） | `llmapi/web/src/pages/channels.tsx:470-504`（行内）、`:65-69`（新建表单） | `slipstream/web/src/pages/upstreams.tsx:24-112` 无 priority 字段，列表列（`:123-155`）也无 | **缺失**（自动组合/分层分流的前提没了） |
| A4 | 协议自动探测 + 来源/鉴权回显 | `llmapi/web/src/pages/channel-detail.tsx:599,833,928-934`；`llmapi/web/src/lib/channels.ts:174-201` | `slipstream/web/src/pages/upstreams.tsx:22` 三个静态 `api_style`（openai_chat / anthropic_messages / other），无 auto、无 `auth_style` | **缺失** |
| A5 | 多密钥（≤20、备注、逐条删除、批量检测导入） | `llmapi/web/src/components/channels/channel-keys-panel.tsx:27,103-205,344-541` | `slipstream/web/src/pages/upstream_detail.tsx:54-56` 只有一行说明「仅后端保存密文（详情接口只回 masked）…轮换走 rotate-key 接口」 | **缺失**：契约有、界面无 |
| A6 | 密钥轮换入口 + 主密钥概念 | `llmapi/docs/ssot.md:341-342`、`llmapi/docs/GLOSSARY.md:22-23` | `slipstream/web/src/pages/upstream_detail.tsx:55` 提到 rotate-key，但页面无按钮，`upstreams.tsx` 也无 | **缺失** |
| A7 | 连通测试（含未保存草稿预检） | `llmapi/web/src/pages/channel-detail.tsx:662-674,439-448`；`llmapi/web/src/lib/channels.ts:233-246` | 7 个新页面均无 test-connection 调用 | **缺失** |
| A8 | 探测记录（状态 + 耗时 + 时间） | `llmapi/web/src/pages/channels.tsx:505-517`、`llmapi/web/src/components/channels/channel-models-panel.tsx:436-451` | `slipstream/web/src/pages/upstreams.tsx:123-155` 表格无该列 | **缺失** |
| A9 | 发现模型（拉上游 `/models` → 勾选 → 批量写入） | `llmapi/web/src/components/channels/discover-models-dialog.tsx:87-488` | `slipstream/web/src/pages/upstream_models.tsx:35-108` 只能手工「登记模型」 | **缺失** |
| A10 | 改写规则（四作用域 + 条件 + 试运行 diff） | `llmapi/web/src/pages/channel-detail.tsx:990-1012`；`llmapi/docs/ssot.md:292-306` | `slipstream/web/src/pages/upstream_detail.tsx:79-85` 有「改写」tab（`TransformsEditor`） | **部分保留**：需逐条核对是否支持 response_* 作用域、条件、试运行 |
| A11 | 启用/封禁快捷开关 | `llmapi/web/src/pages/channels.tsx:520-541`；`llmapi/web/src/pages/channel-detail.tsx:642-653,1038-1052` | `slipstream/web/src/pages/upstreams.tsx:91-95` 仅编辑对话框内的 checkbox | **弱化**：列表无快捷开关，无「封禁」措辞 |
| A12 | 删除渠道 + 引用保护 | `llmapi/web/src/pages/channels.tsx:591-636`（`:605` 组合引用则拒绝） | `slipstream/web/src/pages/upstreams.tsx:161`「契约未开放上游删除，下线请先停用」 | **能力净缺**，但保护更强（无删除即无误删） |
| A13 | 渠道批量（启用/封禁/测速/删除，逐条回报） | `llmapi/web/src/components/channels/channel-batch-toolbar.tsx:6-102`；`llmapi/web/src/pages/channels.tsx:185-238` | `slipstream/web/src/pages/upstreams.tsx:123-155` 无勾选列 | **缺失** |
| A14 | 模型计数（后端 `model_count`） | `llmapi/web/src/pages/channels.tsx:464-468` | `slipstream/web/src/pages/upstreams.tsx:121,140` 前端 filter 现算 | **实现差异**：列表 N 次全表扫描，量大后要回到后端计数 |

### 5.2 上游模型：10 项中 7 项缺失、3 项变形（「调用名」是结构性缺口）

| # | 能力 | 旧仓 | 新仓现状（file:line） | 判定 |
|---|---|---|---|---|
| B1 | **对外调用名 call_model** | `llmapi/web/src/components/channels/channel-model-form-dialog.tsx:489-503`；`llmapi/web/src/lib/channel-models.ts:137` | `slipstream/web/src/pages/upstream_models.tsx:37-42` 表单只有 `name` | **缺失（最重要）**：新仓没有「同一上游模型可被多个对外名复用」的映射层，模型名即身份 |
| B2 | 模型参数（max in/out、推理等级、输入/输出模态、4 能力位） | `llmapi/web/src/components/channels/channel-model-form-dialog.tsx:619-782`；`llmapi/web/src/lib/channel-models.ts:56-72` | `slipstream/web/src/pages/upstream_models.tsx:37-42` 无 | **缺失** |
| B3 | 单价 4 列（含缓存留空语义） | `llmapi/web/src/components/channels/channel-model-form-dialog.tsx:535-616` | `slipstream/web/src/pages/upstream_models.tsx` 无价；价在 `upstream_prices.tsx` 只读 | **结构性改变**：从「随模型编辑」变成「独立版本化价目」 |
| B4 | 类型来源 model_type_source（default/upstream/manual） | `llmapi/web/src/lib/channel-models.ts:92-99`；`llmapi/web/src/components/channels/channel-models-panel.tsx:399-420` | `slipstream/web/src/pages/upstream_models.tsx:188` 只有类型 Badge | **缺失** |
| B5 | 类型枚举 7 类 | `llmapi/web/src/lib/channel-models.ts:82-90` | `slipstream/web/src/pages/upstream_models.tsx:87-91` 只有 chat/embedding/rerank/image | **缺失**：无 audio_tts / audio_transcription / video；`image_generation` 被改名 `image`，迁移要映射 |
| B6 | 模型启用/停用 | `llmapi/web/src/components/channels/channel-models-panel.tsx:174-193` | `slipstream/web/src/pages/upstream_models.tsx:94-97`（表单）+ `:220-225`（批量） | **等价但语义更薄**：新仓只有「停用」，没有「封禁 vs 冷却」两分 |
| B7 | 模型级冷却 / 排期 | `llmapi/web/src/components/channels/channel-model-form-dialog.tsx:784-832`；`llmapi/web/src/pages/models.tsx:1371-1386` | `slipstream/web/src/pages/availability.tsx:184-189` 独立规则页；`:186-188` 明说 scope 仅「上游」「对外模型目标」，`upstream_model` 创建即 422 | **缺失**：没有「从模型行点进去设冷却」的路径 |
| B8 | 探测（单条 / 全部 / 默认探测模型） | `llmapi/web/src/components/channels/channel-models-panel.tsx:124-163,225,373-380` | 新仓无 probe 概念 | **缺失** |
| B9 | 熔断状态回显（health/visible/consecutive/cooldown_until/fault_until） | `llmapi/web/src/lib/channel-models.ts:143-156`；`llmapi/web/src/components/channels/channel-models-panel.tsx:389-395` | 新仓无对应字段 | **缺失** |
| B10 | 批量（≥3 种 op、≤200/批、失败逐条回报、schedule 不静默降级） | `llmapi/web/src/lib/catalog.ts:166-237` | `slipstream/web/src/pages/upstream_models.tsx:202-204,266-286` 仅 enable/disable/delete，返回 `changed/missing` | **部分保留**：失败逐条回报这点做对了，缺 ban/cooldown/schedule |

> 关于 B1 与 A2 的组合效应：旧仓的寻址是 `slug/call_model`（`llmapi/docs/ssot.md:128-135`），两个字段分别落在渠道与渠道模型上。新仓既无 `slug` 又无 `call_model`，等于**放弃了「别名层」**——客户端只能按 `upstream_model_name` 直呼，或走对外模型。这是有意的架构选择，但迁移旧配置时必须显式造出对外模型来承接每个旧 `call_model`。

### 5.3 对外模型 / 组合：11 项差异，含 1 处语义冲突

| # | 能力 | 旧仓 | 新仓现状（file:line） | 判定 |
|---|---|---|---|---|
| C1 | 轮数 max_attempts（完整轮 ≠ 候选数） | `llmapi/web/src/lib/combos.ts:44`；`llmapi/docs/ssot.md:240` | `slipstream/web/src/pages/public_models.tsx:33-38` 表单无该字段 | **缺失** |
| C2 | failover 规则（状态码 + body_regex + next/stop + default_action） | `llmapi/web/src/lib/combos.ts:28-37`；`llmapi/web/src/components/combos/combo-editor-dialog.tsx:640` | `slipstream/web/src/pages/public_models.tsx:24-31` 只有 routing_mode 单选，无规则表 | **缺失** |
| C3 | 路由策略 / 观察窗口覆盖 | `llmapi/web/src/lib/combos.ts:44-46`；`llmapi/web/src/components/combos/combo-editor-dialog.tsx:586-636` | 新仓无 | **缺失** |
| C4 | **priority 方向** | 「越大越先调用」`llmapi/web/src/lib/combos.ts:108-111`、`llmapi/docs/GLOSSARY.md:46` | `slipstream/web/src/pages/public_models.tsx:178`「failover 填 priority（层级，**小优先**）」 | **语义冲突**，必须拍板；同一份数据迁过来会整体倒序 |
| C5 | weight（同层流量配比） | **旧仓明确不设**（`llmapi/docs/ssot.md:239`「组合内不设 weight」） | `slipstream/web/src/pages/public_models.tsx:117-124,170,186` 整数相对比例 | **新仓净增**，不是迁移项 |
| C6 | when 条件表达式 | 旧仓只有 failover 的状态码 + 正则（`llmapi/web/src/lib/combos.ts:29-31`） | `slipstream/web/src/pages/public_models.tsx:141,156,187` 自由文本表达式 | **新仓净增** |
| C7 | 成员身份（渠道模型 / 子组合 / 可用性回显 / 渠道归属） | `llmapi/web/src/lib/combos.ts:9-26`（含 `available`、`channel_slug`、`child_combo_id`） | `slipstream/web/src/pages/public_models.tsx:117-124` 只有 `upstream_model_name` + `upstream_name` | **缺失**：无子组合嵌套、无 `available` 回显、无渠道归属展示 |
| C8 | 嵌套 ≤3 层 + 环检测 + 重复目标校验 | `llmapi/web/src/lib/combos-editor.ts:86-105`；`llmapi/docs/ssot.md:239` | 新仓无嵌套概念 | **缺失**（但无嵌套也就无环） |
| C9 | 自动组合（查询期派生、只读、标「实时派生」） | `llmapi/web/src/lib/catalog.ts:44-69`；`llmapi/docs/GLOSSARY.md:36,131` | 新仓无此概念 | **缺失**：新仓必须显式建对外模型才有裸名 |
| C10 | 统一目录页（kind/协议筛选、状态排序、复制调用名、加入组合、批量条） | `llmapi/web/src/pages/models.tsx:93-108,842-1009`；`llmapi/web/src/components/models/bulk-action-bar.tsx:59-138` | 拆成 `slipstream/web/src/pages/public_models.tsx:213-292` 与 `upstream_models.tsx:110-289` 两页；无统一目录、无「复制调用名」、无「加入组合」 | **形态改变**：管理面从 1 页变 2 页，少了一次跨层核对的机会 |
| C11 | 组合价格区间（成员区间 + 「按实际选中成员计费」） | `llmapi/web/src/lib/combo-params.ts:53-115` | `slipstream/web/src/pages/public_models.tsx:231-256` 无价格列 | **缺失** |

### 5.4 价目：这一块是新仓领先，不是旧仓缺失

| # | 能力 | 旧仓 | 新仓（file:line） | 判定 |
|---|---|---|---|---|
| D1 | 独立价目页（成本账 / 营收账分开） | 无（价格在模型表单里） | `slipstream/web/src/pages/upstream_prices.tsx:32-45`、`downstream_prices.tsx:49-62` | **新仓净增** |
| D2 | 生效时间 / 版本 / 币种 | 无 | `upstream_prices.tsx:20-29`、`downstream_prices.tsx:45-46` | **新仓净增** |
| D3 | 整数微单位（禁浮点） | 无（`number`，`step=0.0001`） | `upstream_prices.tsx:40-43`「单价为每 1M tokens 的整数微单位（计费项 request 按次），禁止浮点」 | **新仓净增** |
| D4 | 改价走「新建版本」、历史账带 `price_version_id` 不重算 | 无（改列即时生效，日志里 `cost_usd` 是快照） | `upstream_prices.tsx:42`、`downstream_prices.tsx:59` | **新仓净增** |
| D5 | 加价补价（markup 万分数，12000 = 1.2 倍） | 无 | `downstream_prices.tsx:21,31-33,57-60` | **新仓净增** |
| D6 | 价目**写入**入口 | 有（模型表单内可改，`channel-model-form-dialog.tsx:535-616`） | 两页都是纯 `useQuery`：`upstream_prices.tsx:33-36`、`downstream_prices.tsx:49-53` | **缺失**：没有「新建版本」按钮，改价只能靠后端/脚本 |
| D7 | 外币汇率 | 无 | 只有 `currency` 列（`upstream_prices.tsx:27`），无汇率表、无换算入口 | **两边都没有** |

### 5.5 可用性：形态不同，能力收窄

| # | 能力 | 旧仓 | 新仓（file:line） | 判定 |
|---|---|---|---|---|
| E1 | 规则化管理（4 种 scope × 4 种复发） | 模型表单排期 + 目录页批量冷却（`catalog.ts:166-203`） | `slipstream/web/src/pages/availability.tsx:79-194` | **形态更好，粒度更粗** |
| E2 | 规则可改 / 可删 / 可提前解除 | 冷却可 `/reset` 清除（`channel-models-panel.tsx:165-172`） | `availability.tsx:185-187`「后端没有规则的编辑/删除接口（全仓无 PATCH/DELETE 路由），因此列表不设操作列，一次性冷却只能等它自然到期」 | **缺失** |
| E3 | scope 覆盖度 | 只到渠道模型（最细粒度） | `availability.tsx:186-188`「scope 仅开放『上游』『对外模型目标』——upstream_model 在创建时即 422」 | **缺失** |
| E4 | 周期窗口（每天/每周/每月 + 跨天） | `llmapi/web/src/lib/channel-models.ts:290-351` | `availability.tsx:26-31,59-77` 支持同样窗口，`:188` 注明半开区间 `[start,end)`、`end ≤ start` 视为跨夜 | **等价**（术语一致，语义需核对半开/闭区间差异） |

### 5.6 建议的补齐顺序（按「不补就没法用」排序）

1. **C4 priority 方向拍板**（一行改动，但错了整层路由倒序）。
2. **B1 调用名 + A2 slug 的替代方案**（决定客户端能不能写 `provider/model`；不补就得为每个旧 `call_model` 建对外模型）。
3. **A7 连通测试 / A9 发现模型 / B8 探测**（新仓目前「登记模型只能靠手打」，这是运营效率的断点）。
4. **A5/A6 多密钥与轮换**（详情页已有文案占位，缺 UI）。
5. **D6 价目写入**（只读价目意味着改价要发版或改库）。
6. A3 优先级、A1 备注、B2 模型参数、B4 类型来源、C2 failover 规则。
7. B7/E2/E3 冷却粒度与可撤销性（旧仓可提前复位，新仓只能等）。

---

## 6. 权限与后端校验点

### 6.1 权限：单管理员 + 路由守卫，没有角色模型

- 管理端是**用户名 + 密码登录、JWT 默认 7 天、单管理员**，密码自己改（`llmapi/docs/ssot.md:338`）。
- 前端只有一个守卫：`ProtectedRoute` 按 `status === "anonymous"` 重定向到 `/login` 并记住来源路径（`llmapi/web/src/components/protected-route.tsx:19-28`）；`PublicOnlyRoute` 反向把已登录用户送回 `/overview`（`:30-36`）。
- 会话恢复与失效：`AuthProvider` 挂载时打 `/api/auth/me`，401 由 `setUnauthorizedHandler` 统一清 token 并转匿名（`llmapi/web/src/lib/auth.tsx:36-68`）。
- **没有 `role` / `admin` / `permission` 判定**：全仓 `web/src` 搜 `role` 只命中 ARIA 与测试夹具；`admin` 只是「当前登录管理员」这个对象类型（`auth.tsx:24,71-79`）。所以「谁能改价 / 谁能删渠道」在旧仓是**不存在的问题**——能登录就能改。
- 结论对 phase2 的直接含义：新仓若要做「价目双人复核」「上游只读运维」「只改可用性不改配置」这类分权，旧仓**没有任何可抄的实现**，只能按 `slipstream` 自己的账号体系重设计。

### 6.2 前端校验（三道，各管一段）

| 位置 | 手段 | 覆盖 |
|---|---|---|
| 新建渠道对话框 | `zod` + `zodResolver`（`llmapi/web/src/components/channels/channel-form-dialog.tsx:45-71`） | name ≤128、url `^https?://`、slug 正则、priority 整数 1–1000、protocol 枚举 |
| 编辑页（另一套手写） | `validate()`（`llmapi/web/src/pages/channel-detail.tsx:402-421`） | 同上，且**编辑态 slug 必填**（`:411-412`），新建态可空 |
| 渠道模型对话框 | `zod`（`llmapi/web/src/components/channels/channel-model-form-dialog.tsx:116-175`） | 模型名正则、价格 ≥0、token 上限 0–1e8、模态 ≥1、能力位布尔 |
| 排期 | `validateScheduleRules`（`llmapi/web/src/lib/channel-models.ts:359-386`） | 每条规则起止必填、weekly 至少一天、monthly 至少一号；`allowEmpty` 区分「渠道表单可空 = 全天」与「批量排期不许空提交」 |
| 组合名 | 正则（`llmapi/web/src/components/combos/combo-editor-dialog.tsx:75`） | 与渠道 slug 同字符集 |
| 目录批量 | `BATCH_LIMIT = 200` 分片（`llmapi/web/src/lib/channel-models.ts:454`、`llmapi/web/src/lib/catalog.ts:211-224`） | 单请求不超过 200 条 |

两处「校验分歧」值得记，因为它们是刻意保留的：编辑页 slug 必填 vs 对话框可空（一个已有的渠道不能把 slug 清空）；批量排期不许空提交（空提交会静默取消已有冷却窗口，`channel-models.ts:371-373` 注释）。

### 6.3 后端校验点（从前端错误面反推，均为可观察证据）

| 校验 | 证据 | 前端处理 |
|---|---|---|
| 字段级 422 | `describeApiError` 专解 FastAPI 的 `details.errors[].loc/msg` 并拼成中文（`llmapi/web/src/lib/channels.ts:339-353`） | 逐条渲染在 Alert 或字段下 |
| 密钥重复 409 | `channel-keys-panel.tsx:52-59` 判 `status === 409 \|\| code === "CONFLICT"` | 「该密钥已存在，未重复添加。」批量时计入 `duplicateCount`（`:171-173`） |
| **删除保护：组合引用** | `channels.tsx:605` 文案 + `:654`（批量时「该渠道会被拒绝删除，其余渠道继续执行」）+ `:607-611` 把错误渲染进对话框 | 拒绝即展示，不静默跳过 |
| 组合删除 / 组合引用模型 | `channel-models-panel.tsx:530`「删除后，使用该调用名的请求将无法路由」 | 破坏性确认 |
| 批量端点缺失 404/405 | `llmapi/web/src/lib/catalog.ts:235-237` `isBatchEndpointMissing` | ban/unban/cooldown 退化为串行；**schedule 直接报错**（`:180-187`） |
| 未实现的可选能力 | 密钥备注 404（`channel-keys-panel.tsx:140-145`） | 明说「后端尚未支持」，不清空输入 |
| 协议 auto 只允许回退到 auto | `channel-detail.tsx:599,833`（`canUseAuto = isNew \|\| protocol_source === "auto"`） | 手工钉过协议就不给退回自动探测 |
| 寻址与命名空间 | `llmapi/docs/ssot.md:128-135`：slug 与组合名共用命名空间、禁止重名；手动组合名不能等于任何自动组合名 | 后端拒，前端只做字符集校验 |

### 6.4 新仓对应位（用于对齐，不评价）

- 前端可保存判定：`slipstream/web/src/pages/upstreams.tsx:46`（baseUrl 非空 + 新建时 vendor 必填）、`upstream_models.tsx:101`（name 非空 + upstream 必选）、`public_models.tsx:108`（name 非空）、`:168-170,204`（priority 数字、weight 整数、行数 >0）。
- 契约限制被写在页面上：`availability.tsx:184-189`（无 PATCH/DELETE、scope 422、半开区间）、`upstreams.tsx:161`（未开放删除）。
- 批量端点靠手写路径而非 `ENDPOINTS`：`upstream_models.tsx:32-33`（注释「ENDPOINTS 暂无 batch 键」）——这正是旧仓 `catalog.ts:166-203` 用「端点缺失即退化」处理的同一类问题，新仓选择了硬编码，**端点上线/改名时不会自动生效**。

---

## 附：本轮读过的文件（便于复核）

旧仓页面：`llmapi/web/src/pages/channels.tsx`、`llmapi/web/src/pages/channel-detail.tsx`、`llmapi/web/src/pages/models.tsx`。

旧仓组件：`llmapi/web/src/components/channels/channel-form-dialog.tsx`、`channel-keys-panel.tsx`、`channel-models-panel.tsx`、`channel-model-form-dialog.tsx`、`channel-batch-toolbar.tsx`、`discover-models-dialog.tsx`、`components/models/model-availability.tsx`、`components/models/bulk-action-bar.tsx`、`components/combos/combo-editor-dialog.tsx`、`components/protected-route.tsx`。

旧仓 lib：`llmapi/web/src/lib/channels.ts`、`catalog.ts`、`channel-models.ts`、`combos.ts`、`combos-editor.ts`、`combo-params.ts`、`auth.tsx`。

旧仓文档：`llmapi/docs/ssot.md`（§3 领域模型与寻址、§5 核心机制含 5.1/5.5/5.6/5.9、§7 数据模型）、`llmapi/docs/GLOSSARY.md`（全文，尤其 §3 优先级与故障转移、§4 可用性与状态、§7 条目与配置对象、§10 路由策略）。

未逐行读完（结论不依赖其细节）：`llmapi/web/src/components/channels/rewrite-rules-editor.tsx`（1220 行，改写能力以 `ssot.md:292-306` 与 `lib/channels.ts:8-51` 的类型为准）、`llmapi/web/src/pages/models.tsx` 的中段渲染（只取了筛选/排序/对话框锚点与价格列）。

新仓：`slipstream/web/src/pages/{upstreams,upstream_detail,upstream_models,public_models,upstream_prices,downstream_prices,availability}.tsx` 全文。


