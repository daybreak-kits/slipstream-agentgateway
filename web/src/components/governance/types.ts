/** 管理员 / 用户（API 消费者）两页的本地类型：字段与后端 snake_case 一一对应，不做二次改名。 */

/** 角色 key 由后端 admin_roles 决定：内置 admin/agent/user，可加自定义角色。 */
export type AdminRole = string;

/** GET /admin/admins 的返回项（后端无 created_at 字段）。 */
export interface AdminAccount {
  id: string;
  username: string;
  role: AdminRole;
}

/** POST /admin/admins 的请求体。 */
export interface AdminCreateInput {
  username: string;
  password: string;
  role: AdminRole;
}

/** PATCH /admin/admins/{id}：登录名不可改，只接受角色与密码。 */
export interface AdminPatchInput {
  role?: AdminRole;
  password?: string;
}

/** GET /admin/users 的返回项（控制面用户 = API 消费者，金额单位 micro）。 */
export interface ConsumerUser {
  id: string;
  name: string;
  balance_micro: number;
  created_at_ms: number;
  /** 旧 mock 只给 ISO 字符串；真实控制面用 created_at_ms。 */
  created_at?: string;
}

/** 账本条目类型（ADb-011：charge 为负 delta）。 */
export type LedgerKind = "charge" | "topup" | "refund" | "adjust";

/** GET /admin/users/{id}/ledger 的返回项。 */
export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  delta_micro: number;
  balance_after_micro: number;
  currency: string;
  ref_type: string | null;
  ref_id: string | null;
  note: string;
  created_by: string;
  created_at_ms: number;
  /** 旧 mock 的账本行用 ts（ISO 字符串）；真实控制面用 created_at_ms。 */
  ts?: string;
}

/** GET /admin/api-keys：密钥只给掩码，密钥数按 user_id 汇总。 */
export interface ApiKeyRow {
  id: string;
  user_id: string;
  mask: string;
  key_suffix: string;
  status: "active" | "disabled";
  created_at_ms: number;
}

/** POST /admin/users/{id}/balance 的返回体。 */
export interface BalanceTopupResult {
  ledger_id?: string;
  /** 旧 mock 只回 { balance_micro }；真实控制面回 balance_after_micro。 */
  balance_after_micro?: number;
}

export interface CreateUserResult {
  id: string;
  name: string;
  balance_micro: number;
  created_at_ms: number;
}
