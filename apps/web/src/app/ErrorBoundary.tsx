import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Last-resort screen instead of a blank page; data stays safe in IndexedDB. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-screen" role="alert">
        <h2>畫面發生錯誤</h2>
        <p>資料仍保存在手機上，重新載入通常就能恢復。</p>
        <button type="button" className="plain-button" style={{ padding: '0 20px' }} onClick={() => window.location.reload()}>
          重新載入
        </button>
        <pre>{this.state.error.message}</pre>
      </div>
    );
  }
}
