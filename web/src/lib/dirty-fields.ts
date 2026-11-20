/**
 * 字段级脏标记的纯函数核心（spec §7 / W2.4）。
 *
 * baseline 是「上一次保存成功时的快照」：保存成功由父级回填 baseline，脏标记自然清零；
 * 保存失败不换 baseline，标记与用户输入都保留。默认用 Object.is 比较，数组/Set/JSON
 * 等复合值由调用方通过 equals 指定比较器（见 sameArray/sameSet/sameJson）。
 */
export type FieldEquals<T extends object> = Partial<
  Record<keyof T, (before: unknown, after: unknown) => boolean>
>;

export interface DiffFieldsOptions<T extends object> {
  /** 按字段覆盖默认的 Object.is 比较。 */
  equals?: FieldEquals<T>;
}

/**
 * 返回相对 baseline 变化的字段集合。
 * baseline 为 null/undefined（新建表单或数据未加载）时返回空集——新表单不该一打开就脏。
 */
export function diffFields<T extends object>(
  baseline: T | null | undefined,
  current: T,
  options?: DiffFieldsOptions<T>,
): Set<keyof T> {
  const dirty = new Set<keyof T>();
  if (!baseline) return dirty;
  const keys = new Set<keyof T>([
    ...(Object.keys(baseline) as Array<keyof T>),
    ...(Object.keys(current) as Array<keyof T>),
  ]);
  for (const key of keys) {
    const equals = options?.equals?.[key];
    const before = baseline[key];
    const after = current[key];
    const same = equals ? equals(before, after) : Object.is(before, after);
    if (!same) dirty.add(key);
  }
  return dirty;
}

/** 数组按元素顺序浅比较（用于 transforms 规则列表这类有序数组）。 */
export function sameArray(before: unknown, after: unknown): boolean {
  if (!Array.isArray(before) || !Array.isArray(after)) return false;
  if (before.length !== after.length) return false;
  return before.every((item, index) => Object.is(item, after[index]));
}

/** Set 按内容比较（用于权限勾选这类 ReadonlySet<string>）。 */
export function sameSet(before: unknown, after: unknown): boolean {
  if (!(before instanceof Set) || !(after instanceof Set)) return false;
  if (before.size !== after.size) return false;
  for (const item of before) if (!after.has(item)) return false;
  return true;
}

/** 结构化 JSON 比较（用于嵌套配置对象；只读场景，不处理循环引用）。 */
export function sameJson(before: unknown, after: unknown): boolean {
  try {
    return JSON.stringify(before) === JSON.stringify(after);
  } catch {
    return Object.is(before, after);
  }
}
