import { useMutation } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { ENDPOINTS, api } from "@/lib/api";

interface CopyKeyButtonProps {
  keyId: string;
}

/**
 * 行内复制小图标（ADR-008 copy-key 特性，ADR-023 连接密钥页口径）：
 * 点击 → 审计化 reveal 拿明文 → 写剪贴板 → toast「密钥已复制」。
 * reveal 会留审计记录，这是预期行为；失败只 toast 错误，不缓存明文。
 */
export function CopyKeyButton({ keyId }: CopyKeyButtonProps) {
  const reveal = useMutation({
    mutationFn: () => api.post<{ key: string }>(ENDPOINTS.apiKeyReveal(keyId), {}),
    onSuccess: (data) => {
      void navigator.clipboard.writeText(data.key);
      toast.success("密钥已复制");
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
