import { useMutation } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { controlPlane } from "@/lib/control-plane";
import { copyText } from "@/lib/clipboard";

interface CopyKeyButtonProps {
  keyId: string;
}

/**
 * 行内复制小图标（ADR-008 copy-key 特性，ADR-023 连接密钥页口径）：
 * 点击 → 审计化 reveal 拿明文 → 剪贴板三级回退 → 只在写入成功后 toast「密钥已复制」。
 * reveal 会留审计记录，这是预期行为；失败 toast 明确错误，不产生未捕获异常。
 */
export function CopyKeyButton({ keyId }: CopyKeyButtonProps) {
  const reveal = useMutation({
    mutationFn: () => controlPlane.clientKeys.reveal(keyId),
    onSuccess: async (data) => {
      const copied = await copyText(data.key);
      if (copied) {
        toast.success("密钥已复制");
      } else {
        toast.error("复制失败", {
          description: "浏览器剪贴板不可用或未授权，请手动抄录掩码旁的明文来源。",
        });
      }
    },
    onError: (error: Error) => toast.error("复制失败", { description: error.message }),
  });
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 w-7 px-0"
      title="复制密钥明文（写入审计）"
      aria-label="复制密钥明文"
      disabled={reveal.isPending}
      onClick={() => reveal.mutate()}
    >
      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
    </Button>
  );
}
