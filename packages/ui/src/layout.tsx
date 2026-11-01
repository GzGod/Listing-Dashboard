"use client";
import React from "react";
import { ds } from "./tokens";

/** 页面顶部标题 + 副标题 */
export const PageHeader = ({ title, subtitle }: { title: string; subtitle?: string }) => (
  <div style={{ marginBottom: 24 }}>
    <h2 style={{ margin: 0, fontSize: ds.txXl, fontWeight: 600, color: ds.text }}>{title}</h2>
    {subtitle && <p style={{ margin: "4px 0 0", fontSize: ds.txSm, color: ds.text2 }}>{subtitle}</p>}
  </div>
);

/** 状态徽章：live（绿）/ mock（琥珀）/ error（红）/ neutral（灰） */
export const StatusBadge = ({
  status,
  variant,
}: {
  status: string;
  variant: "live" | "mock" | "error" | "neutral";
}) => {
  const styles: Record<string, React.CSSProperties> = {
    live:    { background: ds.successBg, color: ds.success  },
    mock:    { background: ds.warningBg, color: ds.warning  },
    error:   { background: ds.errorBg,   color: ds.error    },
    neutral: { background: ds.neutralBg, color: ds.neutral  },
  };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: ds.rFull,
        fontSize: ds.txSm,
        fontWeight: 500,
        whiteSpace: "nowrap",
        ...styles[variant],
      }}
    >
      {status}
    </span>
  );
};

/** 横向表单行，自动换行适配窄屏 */
export const FormRow = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
    {children}
  </div>
);

/** 标签在上、控件在下的字段包装，兼容 input / select */
export const FieldGroup = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: ds.txBase, color: ds.text2, fontWeight: 500 }}>
    {label}
    {children}
  </label>
);
