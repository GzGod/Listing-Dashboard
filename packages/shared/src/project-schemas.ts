import { z } from "zod";
// PD-01 / PD-02 项目资料 JSON 列的结构（m4-admin 写入前校验，M5M6 读取时可复用）
export const CapTableEntrySchema = z.object({ holder: z.string(), pct: z.number().min(0).max(100), note: z.string().optional() });
/** projects.fundamentals：capTable 必有结构，其他字段可选、允许扩展 */
export const FundamentalsSchema = z.object({
  summary: z.string().optional(),
  capTable: z.array(CapTableEntrySchema).optional(),
  tokenomics: z.string().optional(),
  investors: z.array(z.string()).optional(),
}).passthrough();
export const TeamMemberSchema = z.object({ name: z.string(), role: z.string(), bio: z.string().optional(), url: z.string().url().optional() });
/** projects.team */
export const TeamSchema = z.array(TeamMemberSchema);
export const RevenuePeriodSchema = z.enum(["30d", "quarter", "year"]);
export type CapTableEntry = z.infer<typeof CapTableEntrySchema>;
export type Fundamentals = z.infer<typeof FundamentalsSchema>;
export type TeamMember = z.infer<typeof TeamMemberSchema>;
export type Team = z.infer<typeof TeamSchema>;
export type RevenuePeriod = z.infer<typeof RevenuePeriodSchema>;

// —— M5M6 现有代码使用的名字（别名，同一套结构）——
export const capTableRowSchema = CapTableEntrySchema;
export const teamMemberSchema = TeamMemberSchema;
export const projectFundamentalsJsonSchema = FundamentalsSchema;
export const projectTeamJsonSchema = TeamSchema;
export type CapTableRow = CapTableEntry;
