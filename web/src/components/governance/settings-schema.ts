/**
 * 系统设置的前端契约：字段表不再由前端维护。
 *
 * 唯一来源：GET /admin/settings/schema（l05_service/settings_schema.py）。
 * 这里只保留渲染所需的类型、值归一化与“后端多下发的未知键”兜底；
 * 分组顺序、中文标签、类型、范围、选项、默认值全部来自后端。
 */

export interface SettingsItem {
  key: string;
  value: string;
  label?: string;
  description?: string;
  updated_at?: string;
}

export interface SettingsPayload {
  items: SettingsItem[];
}

export type SettingFieldKind = "text" | "number" | "select";

export interface SettingOptionDef {
  value: string;
  label: string;
}

export interface SettingFieldDef {
  key: string;
  label: string;
  description: string;
  kind: SettingFieldKind;
  default: string;
  unit: string;
  min: number | null;
  max: number | null;
  options: SettingOptionDef[];
}

export interface SettingGroupDef {
  key: string;
  title: string;
  description: string;
  fields: SettingFieldDef[];
}

export interface SettingsSchemaPayload {
  groups: SettingGroupDef[];
}

/** 运行信息：环境变量型配置，界面只读，不参与 PUT。 */
export const RUN_INFO_KEYS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "gateway_artifact_path", label: "下发配置落盘路径" },
  { key: "usage_poll_interval_s", label: "用量拉取周期（秒）" },
  { key: "client_key_length", label: "客户端密钥长度" },
  { key: "price_version", label: "当前计价快照" },
];

export function isRunInfoKey(key: string): boolean {
  return RUN_INFO_KEYS.some((item) => item.key === key);
}

/** 兼容两种响应：新契约 {items:[...]} 与旧 mock 的裸数组 [{key,value,description}]。 */
export function normalizeSettings(
  payload: SettingsPayload | SettingsItem[] | null | undefined,
): SettingsItem[] {
  if (!payload) return [];
  const raw = Array.isArray(payload) ? payload : payload.items;
  return raw.filter((item) => typeof item.key === "string" && item.key.length > 0);
}

/** 后端多下发的键（尚未进入 schema）用推断字段展示，仍然可编辑。 */
export function inferField(item: SettingsItem): SettingFieldDef {
  const looksNumeric = /^-?\d+(\.\d+)?$/.test(item.value.trim());
  return {
    key: item.key,
    label: item.label ?? item.key,
    description: item.description ?? "控制面下发的自定义设置键（未在前端登记说明）。",
    kind: looksNumeric ? "number" : "text",
    default: item.value,
    unit: "",
    min: null,
    max: null,
    options: [],
  };
}
