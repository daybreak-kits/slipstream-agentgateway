/**
 * 表格行序（W6 ticket 10 / user story 41-43）：关闭行默认置尾，但不原地修改入参，
 * 也不引入比较器——只做一次稳定分区，启用行保持原有相对顺序（冷却行因此位置不变）。
 * 显式列排序由各表格组件的排序模型接管：排序激活时调用方应跳过本分区（尊重排序）。
 */
export function partitionClosedLast<T>(rows: readonly T[], isClosed: (row: T) => boolean): T[] {
  const open: T[] = [];
  const closed: T[] = [];
  for (const row of rows) {
    (isClosed(row) ? closed : open).push(row);
  }
  return [...open, ...closed];
}
