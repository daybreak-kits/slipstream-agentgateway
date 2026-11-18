import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ChartPlaceholderProps {
  title: string;
  hint: string;
  height?: number;
}

/** v1 骨架用占位图表：数据接通后替换为真实图表实现。 */
export function ChartPlaceholder({ title, hint, height = 180 }: ChartPlaceholderProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="flex items-center justify-center rounded-md border border-dashed border-border bg-surface-2/50"
          style={{ height }}
        >
          <span className="text-2xs text-faint">{hint}</span>
        </div>
      </CardContent>
    </Card>
  );
}
