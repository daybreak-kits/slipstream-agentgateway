import {
  Ban,
  CalendarClock,
  CircleDollarSign,
  CloudDownload,
  Coins,
  Copy,
  Eye,
  FileJson,
  FlaskConical,
  FolderOpen,
  KeyRound,
  Pencil,
  Play,
  PlugZap,
  Plus,
  Receipt,
  RefreshCw,
  Rocket,
  RotateCcw,
  Save,
  Search,
  Snowflake,
  Trash2,
  Undo2,
  Upload,
  UserPlus,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

import type { SemanticTone } from "@/lib/semantic-tone";

/**
 * 动作动词 → lucide 图标单一来源（DESIGN-AUDIT 四期增补 §12，W4-A1）。
 *
 * 行内/批量操作按钮统一「图标 + 短词（2 字为主）」；纯图标按钮必须带 title/aria-label。
 * 同一动词在全站必须是同一图标：新增动词先在这里登记，页面不得各自从 lucide-react 挑图标。
 * 语义色跟随动作性质（§12）：危险=红（text-danger-text）、可逆启停=中性、成功反馈=绿。
 * 注意：本表不设密钥更换映射——该概念已废除（ADR-026），相关入口归 D 波移除。
 */
export const ACTION_ICONS = {
  /** 编辑 */
  edit: Pencil,
  /** 重命名（与编辑同形） */
  rename: Pencil,
  /** 删除（不可逆、服务端删除；红色） */
  delete: Trash2,
  /** 关闭（可逆启停，中性色） */
  disable: Ban,
  /** 启用 */
  enable: Play,
  /** 测试连接 */
  testConnection: PlugZap,
  /** 获取上游模型（从上游渠道拉取模型列表） */
  fetchModels: CloudDownload,
  /** 刷新 / 重试（重试沿用日志页既有 RefreshCw 形） */
  refresh: RefreshCw,
  /** 复制 */
  copy: Copy,
  /** 详情 / 查看 */
  view: Eye,
  /** 添加 / 新建 */
  add: Plus,
  /** 冷却 */
  cooldown: Snowflake,
  /** 解除冷却（撤销语义：把冷却状态撤回来） */
  releaseCooldown: Undo2,
  /** 周期（周期冷却规则） */
  periodic: CalendarClock,
  /** 重置（密钥） */
  resetKey: KeyRound,
  /** 签发密钥（与重置同形：都是生成新密钥材料） */
  issueKey: KeyRound,
  /** 充值 */
  recharge: Wallet,
  /** 调整余额（差额可正可负，区别于充值 Wallet） */
  adjustBalance: Coins,
  /** 新建用户 */
  addUser: UserPlus,
  /** 流水 */
  transactions: Receipt,
  /** 撤销 */
  undo: Undo2,
  /** 恢复默认 / 重置筛选 */
  restore: RotateCcw,
  /** 保存 */
  save: Save,
  /** 导入 */
  import: Upload,
  /** 选择文件 */
  selectFile: FolderOpen,
  /** 试运行 */
  dryRun: FlaskConical,
  /** 下发 */
  deploy: Rocket,
  /** 原始 JSON */
  rawJson: FileJson,
  /** 全局搜索 */
  search: Search,
  /** 清除（筛选/选择）与轻量移除（本地草稿行、非服务端删除，区别于 delete=Trash2） */
  clear: X,
  /** 成员编排 */
  members: Users,
  /** 批量改价 */
  batchPrice: CircleDollarSign,
} as const satisfies Record<string, LucideIcon>;

export type ActionIconKey = keyof typeof ACTION_ICONS;

/**
 * 动作动词 → 语义 tone 单一来源（spec §7 / DESIGN-AUDIT §12）。
 *
 * 启用=成功绿、关闭/冷却=警示琥珀、解除=成功绿、测试=信息蓝、删除=危险红、编辑=中性。
 * 页面用 components/ui/action-button 的 ActionButton 消费本表，不再各自写 text-danger-text。
 */
export const ACTION_TONES = {
  edit: "neutral",
  rename: "neutral",
  delete: "danger",
  disable: "warning",
  enable: "success",
  testConnection: "info",
  fetchModels: "neutral",
  refresh: "neutral",
  copy: "neutral",
  view: "neutral",
  add: "neutral",
  cooldown: "warning",
  releaseCooldown: "success",
  periodic: "neutral",
  resetKey: "neutral",
  issueKey: "neutral",
  recharge: "neutral",
  adjustBalance: "neutral",
  addUser: "neutral",
  transactions: "neutral",
  undo: "neutral",
  restore: "neutral",
  save: "neutral",
  import: "neutral",
  selectFile: "neutral",
  dryRun: "neutral",
  deploy: "neutral",
  rawJson: "neutral",
  search: "neutral",
  clear: "neutral",
  members: "neutral",
  batchPrice: "neutral",
} as const satisfies Record<ActionIconKey, SemanticTone>;
