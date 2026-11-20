import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { roleLabel } from "@/components/governance/roles";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { apiList, ENDPOINTS } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import { fetchRoles } from "@/lib/roles";
import type { ApiKey, PublicModel, Upstream, UpstreamModel, UserTreeNode } from "@/types";

interface SearchHit {
  id: string;
  label: string;
  detail: string;
  path: string;
  keywords: string;
}

/** 本地过滤：任一字段包含关键词即命中；中文按子串匹配，不依赖模糊打分。 */
function filterHits(hits: SearchHit[], query: string): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return hits;
  return hits.filter((hit) => hit.keywords.toLowerCase().includes(needle));
}

function HitGroup({
  heading,
  hits,
  onPick,
}: {
  heading: string;
  hits: SearchHit[];
  onPick: (path: string) => void;
}) {
  if (hits.length === 0) return null;
  return (
    <CommandGroup heading={heading}>
      {hits.map((hit) => (
        <CommandItem key={hit.id} value={hit.id} onSelect={() => onPick(hit.path)}>
          <span className="truncate">{hit.label}</span>
          <span className="ml-auto truncate pl-3 text-2xs text-faint">{hit.detail}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { can } = usePermissions();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const hotkey = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (!hotkey) return;
      event.preventDefault();
      setOpen((prev) => !prev);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // 只在打开时拉取；与页面共享同一组 queryKey，打开即命中缓存。
  // 用户/角色按权限键拉取（DESIGN-AUDIT §13）：无对应权限不发请求、不出现分组。
  const upstreams = useQuery({
    queryKey: ["upstreams"],
    queryFn: () => apiList<Upstream>(ENDPOINTS.upstreams),
    enabled: open,
  });
  const upstreamModels = useQuery({
    queryKey: ["upstream-models"],
    queryFn: () => apiList<UpstreamModel>(ENDPOINTS.upstreamModels),
    enabled: open,
  });
  const publicModels = useQuery({
    queryKey: ["public-models"],
    queryFn: () => apiList<PublicModel>(ENDPOINTS.publicModels),
    enabled: open,
  });
  const apiKeys = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => apiList<ApiKey>(ENDPOINTS.apiKeys),
    enabled: open,
  });
  const canSearchUsers = open && can("users:read");
  const canSearchRoles = open && can("roles:read");
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => apiList<UserTreeNode>(ENDPOINTS.users + "?page_size=200&offset=0"),
    enabled: canSearchUsers,
  });
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: fetchRoles,
    enabled: canSearchRoles,
  });

  const queries = [upstreams, upstreamModels, publicModels, apiKeys, users, roles];
  const loading = queries.some((query) => query.isPending && query.isEnabled);
  const failed = queries.find((query) => query.isEnabled && query.isError);

  const groups = [
    {
      heading: "上游",
      items: (upstreams.data?.items ?? []).map<SearchHit>((row) => ({
        id: "upstream-" + row.id,
        label: row.name,
        detail: row.base_url,
        path: "/upstreams/" + row.id,
        keywords: [row.name, row.vendor_id, row.base_url, row.api_style].join(" "),
      })),
    },
    {
      heading: "上游模型",
      items: (upstreamModels.data?.items ?? []).map<SearchHit>((row) => ({
        id: "upstream-model-" + row.id,
        label: row.name,
        detail: [row.upstream_name, row.model_type].filter(Boolean).join(" · "),
        path: "/models",
        keywords: [row.name, row.upstream_name, row.model_type].filter(Boolean).join(" "),
      })),
    },
    {
      heading: "公开模型",
      items: (publicModels.data?.items ?? []).map<SearchHit>((row) => ({
        id: "public-model-" + row.id,
        label: row.name,
        detail: row.routing_mode,
        path: "/models?tab=public",
        keywords: [row.name, row.routing_mode, row.note].filter(Boolean).join(" "),
      })),
    },
    {
      heading: "连接密钥",
      items: (apiKeys.data?.items ?? []).map<SearchHit>((row) => ({
        id: "api-key-" + row.id,
        label: row.mask,
        detail: [row.key_suffix, row.status].filter(Boolean).join(" · "),
        path: "/client-keys",
        keywords: [row.mask, row.key_suffix, row.user_id, row.status].filter(Boolean).join(" "),
      })),
    },
    {
      heading: "用户",
      items: canSearchUsers
        ? (users.data?.items ?? []).map<SearchHit>((row) => ({
            id: "user-" + row.id,
            label: row.name,
            detail: [row.username, roleLabel(row.role)].filter(Boolean).join(" · "),
            path: "/users",
            keywords: [row.name, row.username, row.role].filter(Boolean).join(" "),
          }))
        : [],
    },
    {
      heading: "角色",
      items: canSearchRoles
        ? (roles.data ?? []).map<SearchHit>((row) => ({
            id: "role-" + row.id,
            label: row.name,
            detail: [row.key, row.member_count + " 名成员"].filter(Boolean).join(" · "),
            path: "/roles",
            keywords: [row.name, row.key, row.description].filter(Boolean).join(" "),
          }))
        : [],
    },
  ].map((group) => ({ heading: group.heading, items: filterHits(group.items, query) }));
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  const pick = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2 border-border-strong bg-surface font-normal text-faint hover:text-body"
        title="全局搜索（⌘K / Ctrl+K）"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4" />
        <span className="hidden text-2sm sm:inline">搜索</span>
        <kbd className="hidden rounded border border-border-strong bg-surface-2 px-1 text-2xs text-muted-foreground sm:inline">⌘K</kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0">
          <DialogTitle className="sr-only">全局搜索</DialogTitle>
          <DialogDescription className="sr-only">
            搜索上游、模型、连接密钥、用户与角色；↑↓ 选择，回车跳转。
          </DialogDescription>
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="搜索上游 / 模型 / 连接密钥 / 用户 / 角色…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              {loading ? <div className="py-6 text-center text-2sm text-faint">正在加载…</div> : null}
              {!loading && failed ? (
                <div className="space-y-1 py-6 text-center text-2sm text-danger-text">
                  <div>加载失败：{failed.error instanceof Error ? failed.error.message : "未知错误"}</div>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-0 text-2xs underline underline-offset-2"
                    onClick={() => void Promise.all(queries.map((query) => query.refetch()))}
                  >
                    重试
                  </Button>
                </div>
              ) : null}
              {!loading && !failed ? (
                <>
                  <CommandEmpty>没有匹配的结果</CommandEmpty>
                  {groups.map((group, index) =>
                    group.items.length > 0 ? (
                      <div key={group.heading}>
                        {index > 0 ? <CommandSeparator /> : null}
                        <HitGroup heading={group.heading} hits={group.items} onPick={pick} />
                      </div>
                    ) : null,
                  )}
                </>
              ) : null}
            </CommandList>
            {!loading && !failed ? (
              <div className="border-t border-border px-3 py-2 text-2xs text-faint">
                共 {total} 条 · ↑↓ 选择 · 回车跳转 · Esc 关闭
              </div>
            ) : null}
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
