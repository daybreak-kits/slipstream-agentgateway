import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import { App } from "./app";
import { Toaster } from "./components/ui/sonner";
import { PermissionsProvider } from "./lib/permissions";
import { queryRetry } from "./lib/query-retry";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    // W6 票07：retry 策略在 lib/query-retry——4xx 不重试，5xx/网络错误最多 1 次。
    queries: { retry: queryRetry, refetchOnWindowFocus: false, staleTime: 15_000 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PermissionsProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </PermissionsProvider>
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
