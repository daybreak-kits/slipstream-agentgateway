import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import { App } from "./app";
import { Toaster } from "./components/ui/sonner";
import { PermissionsProvider } from "./lib/permissions";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 },
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
