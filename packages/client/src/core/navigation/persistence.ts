import { AppError, isAppError } from "@talos/base";
import type { KV } from "@talos/store";
import { isNav } from "./nav.ts";
import type { Nav, NavPersistence } from "./nav.ts";

/** Uses the caller's @talos/store KV in talos-app; never creates another database. */
export class KvNavPersistence implements NavPersistence {
  constructor(private readonly kv: Pick<KV, "get" | "set" | "delete">) {}

  async load(userId: string): Promise<Nav | undefined> {
    const key = this.key(userId);
    const serialized = await this.storage(() => this.kv.get(key));
    if (serialized === undefined) return undefined;
    if (typeof serialized !== "string")
      throw new AppError("E_INTEGRITY", "保存的导航状态格式无效");
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      throw new AppError("E_INTEGRITY", "保存的导航状态无法解析");
    }
    if (!isNav(value)) throw new AppError("E_INTEGRITY", "保存的导航状态无效");
    return value;
  }

  async save(userId: string, state: Nav): Promise<void> {
    const key = this.key(userId);
    if (!isNav(state)) throw new AppError("E_INVALID", "导航状态无效");
    const serialized = JSON.stringify(state);
    await this.storage(() => this.kv.set(key, serialized));
  }

  async remove(userId: string): Promise<void> {
    const key = this.key(userId);
    await this.storage(() => this.kv.delete(key));
  }

  private key(userId: string): string {
    if (!userId.trim()) throw new AppError("E_INVALID", "用户标识不能为空");
    return `nav:v1:${userId}`;
  }
  private async storage<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError("E_UNAVAILABLE", "无法访问导航存储");
    }
  }
}
