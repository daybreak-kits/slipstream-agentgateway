import { Fragment } from "react";

import { parameterDetailRows, parameterLimitPairs, parameterLimitsText } from "@/components/models/model-vocab";
import { HoverInfo } from "@/components/ui/hover-info";
import type { ModelParameters } from "@/types";

/**
 * 模型表参数列单元格（W7 t09 · D9 · spec User Story 36/37）。
 *
 * 列里只放两件最常读的事：输入上限与输出上限（千分位）。上下文之外的
 * 模态、能力、思考档位全部收进悬浮详情，鼠标 hover、键盘 Tab 聚焦、触屏轻点
 * 三路都读得到同一份内容（统一走 HoverInfo 原语，不另起 tooltip）。
 *
 * 正常值不加提示图标：图标在每行重复出现就是噪音，触发元素本身带 cursor-help
 * 与焦点环就够了。缺失值写「未配置」，不用空白也不用输入框式占位。
 */
export function ModelParamsCell({ row }: { row: { parameters?: ModelParameters } }) {
  const text = parameterLimitsText(row);
  const pairs = parameterLimitPairs(row);
  const details = parameterDetailRows(row);
  return (
    <HoverInfo
      side="top"
      align="start"
      label={"模型完整参数：" + text}
      content={
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {details.map((item) => (
            <Fragment key={item.label}>
              <dt className="whitespace-nowrap text-faint">{item.label}</dt>
              <dd className="text-body">{item.value}</dd>
            </Fragment>
          ))}
        </dl>
      }
    >
      <span className="block min-w-0 text-2xs leading-tight">
        {pairs.map((pair) => (
          <span key={pair.label} className="flex items-baseline gap-1.5 whitespace-nowrap">
            <span className="w-4 shrink-0 text-faint">{pair.label}</span>
            <span className="tnum text-body">{pair.value}</span>
          </span>
        ))}
      </span>
    </HoverInfo>
  );
}