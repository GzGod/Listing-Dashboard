import type { ServiceRegistry } from "./types.js";
export class Services implements ServiceRegistry {
  private map = new Map<string, unknown>();
  provide<T>(name: string, impl: T) { if (this.map.has(name)) throw new Error(`service "${name}" 已被注册`); this.map.set(name, impl); }
  get<T>(name: string): T { if (!this.map.has(name)) throw new Error(`service "${name}" 不存在，检查 dependsOn`); return this.map.get(name) as T; }
  has(name: string) { return this.map.has(name); }
  names() { return [...this.map.keys()]; }
}
