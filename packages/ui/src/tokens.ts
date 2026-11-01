/** 设计系统 tokens — 所有模块/Shell 共用此对象，不要在各处写散装颜色数字 */
export const ds = {
  // ── 背景 / 表面 ────────────────────────────────────────────────
  bg:           "#f6f7f9",
  surface:      "#ffffff",
  surfaceHover: "#f9fafb",

  // ── 边框 ───────────────────────────────────────────────────────
  border:      "#e4e6eb",
  borderLight: "#f0f1f3",

  // ── 文字 ───────────────────────────────────────────────────────
  text:  "#1a1d23",   // 主文字（石墨）
  text2: "#5c6270",   // 次级说明
  text3: "#9099a8",   // 占位 / 禁用

  // ── 强调色（靛蓝） ─────────────────────────────────────────────
  accent:      "#4f5ef7",
  accentHover: "#3d4ce0",
  accentLight: "#eef0fe",
  accentText:  "#3730a3",

  // ── 侧边栏（深色） ─────────────────────────────────────────────
  sidebarBg:         "#151820",
  sidebarBorder:     "#252a3a",
  sidebarText:       "#9099a8",
  sidebarText2:      "#c8cdd7",
  sidebarTextActive: "#ffffff",
  sidebarHover:      "rgba(255,255,255,0.05)",
  sidebarActive:     "rgba(79,94,247,0.15)",
  sidebarAccent:     "#4f5ef7",

  // ── 语义色 ─────────────────────────────────────────────────────
  success:       "#16a34a",
  successBg:     "#f0fdf4",
  successBorder: "#bbf7d0",

  warning:       "#d97706",
  warningBg:     "#fffbeb",
  warningBorder: "#fde68a",

  error:         "#dc2626",
  errorBg:       "#fef2f2",
  errorBorder:   "#fecaca",

  mock:         "#7c3aed",
  mockBg:       "#f5f3ff",
  mockBorder:   "#ddd6fe",

  neutral:       "#5c6270",
  neutralBg:     "#f3f4f6",
  neutralBorder: "#e5e7eb",

  // ── 圆角 ───────────────────────────────────────────────────────
  rSm:   4,
  r:     6,
  rMd:   8,
  rLg:   12,
  rFull: 9999,

  // ── 字号 ───────────────────────────────────────────────────────
  txXs:   11,
  txSm:   12,
  txBase: 13,
  txMd:   14,
  txLg:   16,
  txXl:   20,
} as const;
