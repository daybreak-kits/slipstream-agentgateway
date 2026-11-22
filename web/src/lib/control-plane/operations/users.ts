import type {
  BalanceAdjust,
  BalanceTopup,
  UserCreate,
  UserPasswordReset,
  UserUpdate,
} from "@/generated/contract";
import type { LedgerEntry } from "@/components/governance/types";
import type { UserTreeResponse, UserTreeNode } from "@/types";

import type { OperationOptions } from "../types";

/** 创建用户的响应：一次性初始密码只在这一条路径出现（ADR-019）。 */
export type CreatedUser = UserTreeNode & { initial_password?: string };

/** 余额变动结果：页面只需要变动后的余额。 */
export interface BalanceResult {
  balance_after_micro: number;
}

/** 重置密码结果：回显登录名，提示已有会话注销。 */
export interface PasswordResetResult {
  id: string;
  username: string;
}

/** 删除（软删）结果。 */
export interface DeleteUserResult {
  id: string;
  status: string;
}

/**
 * 统一用户表（ADR-019）操作：列表/树/CRUD/余额/密码/流水。
 * 分页、树展开与权限键判定留在适配器与页面；这里只给域语义。
 */
export interface UsersOperations {
  /** GET /admin/users：按调用者作用域可见的用户列表（扁平）。 */
  list(options?: OperationOptions): Promise<UserTreeNode[]>;
  /** GET /admin/users/tree：扁平树 + 可见森林根，供用户面板渲染层级。 */
  tree(options?: OperationOptions): Promise<UserTreeResponse>;
  /** POST /admin/users：创建账号；响应可能带一次性初始密码。 */
  create(body: UserCreate): Promise<CreatedUser>;
  /** PATCH /admin/users/{id}：局部编辑（名字/角色/父级/状态）。 */
  update(id: string, body: UserUpdate): Promise<UserTreeNode>;
  /** DELETE /admin/users/{id}：软删除，余额与流水留档。 */
  remove(id: string): Promise<DeleteUserResult>;
  /** PUT /admin/users/{id}/password：重置密码，已有会话注销。 */
  resetPassword(id: string, body: UserPasswordReset): Promise<PasswordResetResult>;
  /** POST /admin/users/{id}/balance：充值。 */
  topup(id: string, body: BalanceTopup): Promise<BalanceResult>;
  /** POST /admin/users/{id}/balance/adjust：手工调整（正负均可）。 */
  adjust(id: string, body: BalanceAdjust): Promise<BalanceResult>;
  /** GET /admin/users/{id}/ledger：最近流水（分页由适配器固定首页大小）。 */
  ledger(id: string, options?: OperationOptions): Promise<LedgerEntry[]>;
}
