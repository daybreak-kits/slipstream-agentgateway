import { Component, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** 路由级兜底：单页渲染异常只倒这一页，显示错误信息与重试，不再整站白屏。 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-danger bg-surface p-6">
          <h2 className="text-h1 font-semibold text-danger-text">页面渲染失败</h2>
          <p className="mt-2 text-2sm text-body">{String(this.state.error.message ?? this.state.error)}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => this.setState({ error: null })}>
            重试
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}