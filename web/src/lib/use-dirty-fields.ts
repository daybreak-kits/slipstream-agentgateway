import { useMemo } from "react";

import { diffFields, type DiffFieldsOptions } from "@/lib/dirty-fields";

export interface DirtyFieldsState<T extends object> {
  /** 相对 baseline 变化的字段。 */
  dirtyFields: Set<keyof T>;
  /** 变化字段数（区块标题/底部摘要用）。 */
  dirtyCount: number;
  /** 是否有任何字段变化（离开拦截、保存按钮用）。 */
  isDirty: boolean;
  /** 单字段判断（字段左侧色条/浅底/「已修改」点用）。 */
  isDirtyField: (field: keyof T) => boolean;
}

/**
 * 字段级脏标记 hook：baseline 通常是「上一次保存成功时」的快照。
 * 父级保存成功回填 baseline 后脏标记自动清零；保存失败保持 baseline 不变即可保留标记。
 */
export function useDirtyFields<T extends object>(
  baseline: T | null | undefined,
  current: T,
  options?: DiffFieldsOptions<T>,
): DirtyFieldsState<T> {
  const equals = options?.equals;
  const dirtyFields = useMemo(
    () => diffFields(baseline, current, equals ? { equals } : undefined),
    [baseline, current, equals],
  );
  return useMemo(
    () => ({
      dirtyFields,
      dirtyCount: dirtyFields.size,
      isDirty: dirtyFields.size > 0,
      isDirtyField: (field: keyof T) => dirtyFields.has(field),
    }),
    [dirtyFields],
  );
}
