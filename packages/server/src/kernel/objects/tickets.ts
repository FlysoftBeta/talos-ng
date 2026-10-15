import { randomBytes } from "node:crypto";
import { AppError } from "@talos/base";
import { isObjectId } from "@talos/objectstore";

export interface DownloadTicket {
  objectId: string;
  user: string;
  filename: string;
  mime: string;
  expires: number;
  /** Generated downloads stream directly; authority is still checked on resolution. */
  source?: { size: number; read(): AsyncIterable<Uint8Array> };
}
export interface TicketOptions {
  clock?: () => number;
  random?: () => string;
  ttlMs?: number;
  maxTickets?: number;
  access?: (user: string, objectId: string) => boolean | Promise<boolean>;
}
/** Short-lived bearer capability. User/access binding is checked again on every range request. */
export class TicketService {
  private readonly tickets = new Map<string, DownloadTicket>();
  private readonly clock: () => number;
  constructor(private readonly options: TicketOptions = {}) {
    if (
      !Number.isSafeInteger(options.maxTickets ?? 10_000) ||
      (options.maxTickets ?? 10_000) < 1
    )
      throw new AppError("E_INVALID", "无效的下载凭证数量限制");
    this.clock = options.clock ?? Date.now;
    if (
      !Number.isSafeInteger(options.ttlMs ?? 300_000) ||
      (options.ttlMs ?? 300_000) <= 0
    )
      throw new AppError("E_INVALID", "无效的下载凭证有效期");
  }
  issue(input: Omit<DownloadTicket, "expires">): {
    ticket: string;
    url: string;
    expires: number;
  } {
    if (
      !isObjectId(input.objectId) ||
      !input.user ||
      !input.filename ||
      /[\r\n\x00]/.test(input.filename) ||
      !/^[\w.+-]+\/[\w.+-]+(?:;[\x20-\x7e]*)?$/.test(input.mime)
    )
      throw new AppError("E_INVALID", "无效的下载信息");
    this.sweep();
    if (this.tickets.size >= (this.options.maxTickets ?? 10_000))
      throw new AppError("E_BUSY", "下载凭证数量已达上限");
    const ticket = (
      this.options.random ?? (() => randomBytes(32).toString("base64url"))
    )();
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(ticket) || this.tickets.has(ticket))
      throw new AppError("E_CONFLICT", "无法生成下载凭证");
    const expires = this.clock() + (this.options.ttlMs ?? 300_000);
    this.tickets.set(ticket, { ...input, expires });
    return { ticket, url: `/dl/${ticket}`, expires };
  }
  async resolve(ticket: string): Promise<DownloadTicket> {
    const record = this.tickets.get(ticket);
    if (!record || record.expires <= this.clock()) {
      this.tickets.delete(ticket);
      throw new AppError("E_NOT_FOUND", "下载凭证不存在或已过期");
    }
    if (
      this.options.access &&
      !(await this.options.access(record.user, record.objectId))
    ) {
      this.tickets.delete(ticket);
      throw new AppError("E_DENIED", "下载权限已撤销");
    }
    return { ...record };
  }
  revokeUser(user: string): void {
    for (const [key, value] of this.tickets)
      if (value.user === user) this.tickets.delete(key);
  }
  sweep(): number {
    let removed = 0;
    for (const [key, value] of this.tickets)
      if (value.expires <= this.clock()) {
        this.tickets.delete(key);
        removed++;
      }
    return removed;
  }
}
