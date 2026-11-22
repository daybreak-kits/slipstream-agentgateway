import type { ProfileIn, SelfPasswordChange } from "@/generated/contract";
import type {
  SettingsItem,
  SettingsPayload,
  SettingsSchemaPayload,
} from "@/components/governance/settings-schema";
import type { ConnectionInfo, MySpendResponse, UserPreferences } from "@/types";

import type { OperationOptions } from "../types";

/** GET /admin/settings：新契约 {items} 与旧裸数组都可能在演示数据里出现。 */
export type SettingsResponse = SettingsPayload | SettingsItem[];

export interface SettingsSaveResult {
  values: Record<string, string>;
}

export interface PasswordChangeResult {
  ok: boolean;
  revoked_sessions: number;
}

export interface SpendQuery {
  range: string;
  scope: "self" | "subtree";
}

/**
 * 用户设置 / 运营设置操作：连接地址、偏好、资料、系统参数与 schema、自助改密、我的花费。
 * （设置分组/字段说明由后端 schema 驱动，前端不维护字段表。）
 */
export interface SettingsOperations {
  /** GET /admin/connection：统一连接地址（所有用户共用）。 */
  connection(options?: OperationOptions): Promise<ConnectionInfo>;
  /** GET /admin/auth/preferences：当前登录人的通知/主题偏好。 */
  preferences(options?: OperationOptions): Promise<UserPreferences>;
  /** PUT /admin/auth/preferences：整份偏好覆盖写。 */
  savePreferences(next: UserPreferences): Promise<UserPreferences>;
  /** PATCH /admin/auth/me：改展示名。 */
  saveProfile(body: ProfileIn): Promise<void>;
  /** GET /admin/settings：系统参数当前值。 */
  getSettings(options?: OperationOptions): Promise<SettingsResponse>;
  /** PUT /admin/settings：只提交本轮改动的键值。 */
  saveSettings(values: Record<string, string>): Promise<SettingsSaveResult>;
  /** GET /admin/settings/schema：字段表（分组/标签/范围/选项）。 */
  getSettingsSchema(options?: OperationOptions): Promise<SettingsSchemaPayload>;
  /** POST /admin/auth/change-password：验证旧密码后改密，吊销其它会话。 */
  changePassword(body: SelfPasswordChange): Promise<PasswordChangeResult>;
  /** GET /admin/bills/my-spend：用户层级账单汇总。 */
  mySpend(query: SpendQuery, options?: OperationOptions): Promise<MySpendResponse>;
}
