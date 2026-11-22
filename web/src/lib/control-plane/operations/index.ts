/** ControlPlane：按领域组合 typed operations 的聚合接口（页面只依赖这个形状）。 */

import type { AuditsOperations } from "./audits";
import type { AuthOperations } from "./auth";
import type { ClientKeysOperations } from "./client-keys";
import type { ConfigOperations } from "./config";
import type { GovernanceOperations } from "./governance";
import type { PlaygroundOperations } from "./playground";
import type { PricesOperations } from "./prices";
import type { LogsOperations } from "./logs";
import type { ModelsOperations } from "./models";
import type { RolesOperations } from "./roles";
import type { SettingsOperations } from "./settings";
import type { SystemOperations } from "./system";
import type { ReportsOperations } from "./reports";
import type { UpstreamsOperations } from "./upstreams";
import type { UsersOperations } from "./users";

export interface ControlPlane {
  upstreams: UpstreamsOperations;
  models: ModelsOperations;
  reports: ReportsOperations;
  logs: LogsOperations;
  users: UsersOperations;
  clientKeys: ClientKeysOperations;
  roles: RolesOperations;
  auth: AuthOperations;
  settings: SettingsOperations;
  config: ConfigOperations;
  governance: GovernanceOperations;
  prices: PricesOperations;
  audits: AuditsOperations;
  playground: PlaygroundOperations;
  system: SystemOperations;
}
