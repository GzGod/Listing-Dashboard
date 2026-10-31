'use client';
import { Component, type ReactNode } from 'react';

/** Module-local error boundary (no cross-module import). One failing block never takes down the page. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('[m5-rankings]', this.props.label, error); }
  render() {
    if (this.state.error) return (
      <div role="alert" style={{ padding: 16, border: '1px solid #f5c2c7', background: '#fff5f5', borderRadius: 8 }}>
        <b>{this.props.label ?? '模块'}加载出错</b>
        <div style={{ color: '#888', fontSize: 12 }}>{this.state.error.message}</div>
        <button onClick={() => this.setState({ error: null })}>重试</button>
      </div>
    );
    return this.props.children;
  }
}
