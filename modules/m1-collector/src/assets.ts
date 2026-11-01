export interface MarketProject { id: number; symbol: string }
export interface AssetMapping { project_id: number; exchange_id: number; base_symbol: string; note: string }

/** 身份优先于 ticker：碰到同名资产时必须明确映射，不能复制同一行情到多个项目。 */
export function resolveAssets(projects: MarketProject[], mappings: AssetMapping[], exchangeId: number) {
  const counts = new Map<string, number>();
  for (const p of projects) counts.set(p.symbol.toUpperCase(), (counts.get(p.symbol.toUpperCase()) ?? 0) + 1);
  const explicit = new Map(mappings.filter((m) => m.exchange_id === exchangeId).map((m) => [m.project_id, m.base_symbol.toUpperCase()]));
  const chosen = new Map<number, string>();
  const blocked: number[] = [];
  for (const p of projects) {
    const symbol = p.symbol.toUpperCase();
    const base = explicit.get(p.id) ?? (counts.get(symbol) === 1 ? symbol : undefined);
    if (base) chosen.set(p.id, base); else blocked.push(p.id);
  }
  const byBase = new Map<string, number[]>();
  for (const [id, base] of chosen) byBase.set(base, [...(byBase.get(base) ?? []), id]);
  for (const ids of byBase.values()) if (ids.length > 1) for (const id of ids) { chosen.delete(id); blocked.push(id); }
  return { chosen, blocked };
}
