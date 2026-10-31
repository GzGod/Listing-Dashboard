"use client";
import React from "react";
/** 每个模块页面外面包一层：模块报错只显示“该模块暂不可用”，不影响外壳和其他页面 */
export class ModuleErrorBoundary extends React.Component<{ module: string; children: React.ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(`[module:${this.props.module}]`, error); }
  render() {
    if (this.state.error) return (<div style={{ padding: 24, border: "1px dashed #f59e0b", borderRadius: 8, background: "#fffbeb" }}>
      <b>该模块暂不可用</b><div style={{ color: "#6b7280", fontSize: 13, marginTop: 6 }}>{this.props.module}：{this.state.error.message}</div></div>);
    return this.props.children;
  }
}
