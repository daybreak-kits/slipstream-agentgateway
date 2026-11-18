# 改写规则（A 模式）：统一动作词表 → AG transformations CEL

- 状态：定稿 v2（2026-11-17 用户二次裁定：头与体共用同一套动作词表）
- 关联：ADR-005、`docs/contracts/ir-and-rendering.md`、`docs/PLAN.md` §17

## 1. 一句话

管理员在界面编辑**结构化规则行**；控制面存 JSON；适配层编译成 agentgateway `providers[].policies.transformations` 的 CEL（按上游挂载；AG 侧挂载点确认仍待 E9）。
**请求头与请求体使用同一套动词**，不引入第二套词汇。

## 2. 统一动作词表（头与体共用）

| 动作 | 语义 | 请求头编译 | 请求体编译 |
|---|---|---|---|
| `create` | 不存在才写，已存在保持不变 | `add`（同名头已存在时以 set 兜底） | 条件表达式：字段为空才 merge |
| `update` | 存在才覆盖，不存在保持不变 | `set` | 条件表达式：字段非空才覆盖 |
| `delete` | 删除；不存在视为成功 | `remove` | `filterKeys` 过滤 |
| `copy` | 从源复制到目标 | 源头值写入目标头 | 源路径值写入目标路径 |
| `prepend` | 字符串开头插入 | 头值前缀 | 字段字符串前缀 |
| `append` | 字符串结尾追加 | 头值后缀 | 字段字符串后缀 |
| `regex_replace` | 按正则替换 | `regexReplaceAll(headers["K"], regex, replacement)` | `regexReplaceAll(字段引用, regex, replacement)` |
| `to_upper` | 转大写 | 头值大写 | 字段字符串大写 |
| `to_lower` | 转小写 | 头值小写 | 字段字符串小写 |

- **rename 不再是独立动作**：界面上「重命名」= 一行 `copy` + 一行 `delete`，编辑器提供一键生成两行的按钮。这样头与体只有一套概念。
- 四段：`request_headers` / `request_body` / `response_headers` / `response_body`，四段动作词表完全相同。
- 条件：`full`（等于）/ `regex` / `gt` / `gte` / `lt` / `lte`，同一行的多条件按「与」组合。

## 3. 编译要点

AG 的 `request.body`/`response.body` 是**字符串**；可用 `json()` 解析、`toJson()` 序列化、`with` 绑定、`merge` 合并、`filterKeys` 过滤、`mapValues` 逐值处理。

- 头：`create`→`add`、`update`→`set`、`delete`→`remove`，其余动作对 `request.headers["K"]` 做字符串运算后 `set`。
- 体：`toJson(json(request.body).with(b, ...))` 组装；嵌套路径用嵌套 `with`。
- 顺序：界面行序 = 编译后应用顺序；同段内后行可引用前行结果。
- `regex_replace` 两侧都编译成 CEL 的 `regexReplaceAll(<ref>, <regex>, <replacement>)`：`regex` 按正则解释、不做固定子串匹配，也不存在「只认预置模式」的降级分支；存储里 `regex` 与 `replacement` 是两个独立字段。
- 条件：进入 `transformations.conditional[]`，**无条件兜底项必须在末位**（AG 硬要求）。

## 4. 不变量

1. **保护头禁止改写**：`authorization`、`api-key`、`x-api-key`、`cookie`、`set-cookie`、`content-type`、`content-length`、`host`、`x-request-id`——界面即拦截，后端也拒绝。
2. 无条件条目只能在末位，否则校验失败。
3. **体上限**：AG 默认缓冲 2 MiB，超限时 body 变量取不到值；超限请求跳过改写并记录原因，不能报 500。
4. **流式互斥**：`response_body` 规则仅对非流式生效；流式跳过并记 `rewrite_skipped=stream`。
5. **幂等**：同一 IR 渲染两次字节级相同。
6. **体路径不设白名单**（W2）：`model` / `stream` 也可以改，改 `model` 会影响后续选路、动 `stream` 可能破坏 SSE 帧，风险归管理员；头路径仍受保护头约束。

## 5. 存储形态（snake_case）

```json
{
  "request_headers": [
    {"op": "update", "name": "x-trace", "value": "slipstream", "conditions": []}
  ],
  "request_body": [
    {"op": "update", "path": "temperature", "value": 0.2,
     "conditions": [{"field": "model", "mode": "full", "value": "glm-5.3"}]}
  ],
  "response_headers": [],
  "response_body": []
}
```

## 6. E9 的已验结论（原「待实验」项）

- `request.set/add/remove` 发生在**上游转发前**，实测生效。
- `json(body).with(...)` 的嵌套写法：当前用嵌套 `merge` 表达 `a.b.0.c`，未触到表达式长度上限。
- CEL **提供**字符串函数：`regexReplaceAll`、`upperAscii`、`lowerAscii`（另有 `replace` / `trim` / `split` / `substring` 等），因此 `regex_replace` / `to_upper` / `to_lower` 三类全部落地，**不需要置灰**，也不再有「不支持则置灰」的分支。
- `response_body` 规则只对非流式生效（响应体改写与流式互斥），跳过时记 `rewrite_skipped=stream`；改写响应体后用量字段以 AG `request_logs` 为准（R7）。

## 7. P0 实测后追加的硬规则（E9）

实验已证实 transformations 的头/体改写全部生效，同时暴露三个必须堵住的口子：

1. **后端不对改写内容设限制（W2）**：`model`、`stream`、`messages` 都可以改，控制权完全在管理员；`api/src/l02_domain/transforms_codec.py` 只做路径形状校验（`body op ... needs a path`），不设路径黑名单。契约要求 UI 只提示不阻断。
   - 当前实现状态（12:40 已跟随）：`transforms-editor.tsx` 已删除 `RESERVED_BODY_PATHS` 与 `isReservedBodyPath`，`ruleValid` 只拦保护头；改 `model` / `stream` 时给黄色提示（影响后续选路 / SSE 帧），**只提示不阻断**，与 W2 一致。
2. **不对响应改写加默认条件（W1）**：错误体是否一起改写由管理员决定，平台不预设。`render.py:with_default_actions()` 不再注入 `response.code < 400`；`test_default_actions_only_two_header_deletes` 断言渲染文本里不出现 `response.code`。
   - 当前实现状态（12:40 已跟随）：改写页只读块改为「响应改写默认条件：无（W1 整改）」，文案要求管理员自行加 `response.code < 400` 条件行。
3. **默认剔除上游指纹头**：每个上游自动追加**两条**响应头 `delete`（`server`、`x-powered-by`），位置在用户规则之后。这两条不出现在用户规则列表里，在「系统默认规则」只读区块展示。