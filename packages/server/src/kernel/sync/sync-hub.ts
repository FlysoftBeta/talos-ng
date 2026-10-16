import { randomUUID } from "node:crypto";
import { AppError, utf8Encode } from "@talos/base";
import { selectDelta } from "@talos/sync";
import {
  DEFAULT_SYNC_ROWS,
  MAX_SYNC_BYTES,
  WINDOW_RESET_THRESHOLD,
} from "@talos/contract";
import type { Row, ScopePull } from "@talos/sync";

/** Providers return a coherent revision-ordered snapshot, including tombstones. */
export interface ScopeProvider {
  match(scopeId: string): boolean;
  access(user: string, scopeId: string): boolean;
  list(user: string): readonly string[];
  select(scopeId: string, sinceRev: number, limit: number): readonly Row[];
}
export interface EntitySerializer {
  windowed?: boolean;
  serialize(row: Row): Row;
  read(scopeId: string, id: string): Row | undefined;
}
export interface SyncConnection {
  readonly id: string;
  emit(topic: string, data: unknown): void;
}
export interface SyncRequest {
  cursors: Readonly<Record<string, number>>;
  limit?: number;
  continuation?: string;
}
export interface SyncResponse {
  scopes: Record<string, ScopePull>;
  gone: string[];
  added: string[];
  transfer?: { token: string; chunk: string; more: boolean };
  repull?: boolean;
}
export interface SyncChangeSet {
  rev: number;
  changes: readonly { scope: string; type: string; id: string }[];
}
export interface SyncHubOptions {
  revision(): number;
  now?(): number;
  pageSize?: number;
  windowResetThreshold?: number;
  reportError?(error: unknown): void;
}
interface Subscription {
  user: string;
  connection: SyncConnection;
  known: Set<string>;
  complete: Set<string>;
}

/** Pull is authoritative; failed pushes suspend live delivery until repaired. */
export class SyncHub {
  private readonly providers = new Set<ScopeProvider>();
  private readonly entities = new Map<string, EntitySerializer>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly transfers = new Map<
    string,
    {
      user: string;
      token: string;
      json: string;
      offset: number;
      expires: number;
      scopes: Set<string>;
      dirty: boolean;
      subscription?: Subscription;
      complete: Set<string>;
    }
  >();
  private readonly pageSize: number;
  private readonly resetThreshold: number;

  constructor(private readonly options: SyncHubOptions) {
    this.pageSize = options.pageSize ?? DEFAULT_SYNC_ROWS;
    this.resetThreshold =
      options.windowResetThreshold ?? WINDOW_RESET_THRESHOLD;
    this.positive(this.pageSize, "同步分页大小");
    this.positive(this.resetThreshold, "窗口重置阈值");
  }

  registerProvider(provider: ScopeProvider): () => void {
    this.providers.add(provider);
    return () => {
      this.providers.delete(provider);
    };
  }

  registerEntity(type: string, serializer: EntitySerializer): () => void {
    if (this.entities.has(type))
      throw new AppError("E_CONFLICT", `同步数据类型已注册`);
    this.entities.set(type, serializer);
    return () => {
      this.entities.delete(type);
    };
  }

  pull(
    user: string,
    request: SyncRequest,
    connection?: SyncConnection,
  ): SyncResponse {
    if (connection) {
      const previous = this.subscriptions.get(connection.id);
      if (previous && previous.user !== user) this.unsubscribe(connection.id);
    }
    const transferKey = connection
      ? `connection:${connection.id}`
      : `user:${user}`;
    const now = (this.options.now ?? Date.now)();
    for (const [key, transfer] of this.transfers)
      if (transfer.expires <= now) this.transfers.delete(key);
    if (request.continuation)
      return this.continueTransfer(user, transferKey, request.continuation);
    this.transfers.delete(transferKey);
    const limit = request.limit ?? this.pageSize;
    this.positive(limit, "每页记录数");
    const revision = this.options.revision();
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new AppError("E_INTERNAL", "同步版本异常，请稍后重试");
    }
    for (const cursor of Object.values(request.cursors)) {
      if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > revision) {
        throw new AppError("E_INVALID", "同步进度无效，请重新同步");
      }
    }
    const accessible = this.scopes(user);
    const response = this.response(
      accessible,
      new Set(Object.keys(request.cursors)),
    );
    let subscription: Subscription | undefined;
    if (connection) {
      const previous = this.subscriptions.get(connection.id);
      // Rebinding must discard the previous user's access even if this pull fails.
      if (previous && previous.user !== user)
        this.subscriptions.delete(connection.id);
      subscription = {
        user,
        connection,
        known: accessible,
        complete:
          previous?.user === user ? new Set(previous.complete) : new Set(),
      };
      for (const scope of subscription.complete) {
        if (!accessible.has(scope)) subscription.complete.delete(scope);
      }
    }
    let remainingBytes = MAX_SYNC_BYTES;
    for (const scope of accessible) {
      const cursor = request.cursors[scope] ?? 0;
      const { rows, reset } = this.select(user, scope, cursor, limit, revision);
      const selected = selectDelta(rows, cursor, limit);
      const wireRows = selected.rows.map((row) =>
        this.serialize(row, revision),
      );
      let end = 0;
      while (end < wireRows.length) {
        let next = end + 1;
        while (
          next < wireRows.length &&
          wireRows[next]!.rev === wireRows[end]!.rev
        )
          next++;
        const bytes = utf8Encode(
          JSON.stringify(wireRows.slice(end, next)),
        ).length;
        // A large revision must remain atomic. Transfer its serialized page in
        // fragments rather than rejecting legal rows or splitting the cursor.
        if (bytes > remainingBytes && remainingBytes !== MAX_SYNC_BYTES) break;
        remainingBytes -= bytes;
        end = next;
      }
      const omitted = end < wireRows.length;
      const page = {
        rows: wireRows.slice(0, end),
        cursor: omitted ? (wireRows[end - 1]?.rev ?? cursor) : selected.cursor,
        more: omitted || selected.more,
      };
      // Once all returned rows are included, skipped window rows and empty revisions
      // are covered too. Partial pages must not advance past unreturned ordinary rows.
      const pull: ScopePull = {
        rows: page.rows,
        cursor: page.more ? page.cursor : revision,
        more: page.more,
        ...(reset.length > 0 ? { reset } : {}),
      };
      response.scopes[scope] = pull;
      if (subscription) {
        if (pull.more) subscription.complete.delete(scope);
        else subscription.complete.add(scope);
      }
    }
    if (utf8Encode(JSON.stringify(response)).length > MAX_SYNC_BYTES) {
      // Hold completion until the final fragment. Only actual intervening
      // changes require catch-up; large metadata-only snapshots must converge.
      const complete = new Set(subscription?.complete);
      if (subscription) {
        subscription.complete.clear();
        this.subscriptions.set(subscription.connection.id, subscription);
      }
      this.transfers.set(transferKey, {
        user,
        token: randomUUID(),
        json: JSON.stringify(response),
        offset: 0,
        expires: now + 60_000,
        scopes: accessible,
        dirty: false,
        subscription,
        complete,
      });
      return this.continueTransfer(user, transferKey);
    }
    // A failed pull must not publish a partial subscription.
    if (subscription)
      this.subscriptions.set(subscription.connection.id, subscription);
    return response;
  }

  committed(changeSet: SyncChangeSet): void {
    if (
      !Number.isSafeInteger(changeSet.rev) ||
      changeSet.rev < 1 ||
      changeSet.rev > this.options.revision()
    ) {
      this.report(new AppError("E_INTERNAL", "同步变更版本异常，请稍后重试"));
      return;
    }
    for (const transfer of this.transfers.values())
      if (changeSet.changes.some((change) => transfer.scopes.has(change.scope)))
        transfer.dirty = true;
    for (const subscription of this.subscriptions.values()) {
      try {
        const accessible = this.scopes(subscription.user);
        const response = this.response(accessible, subscription.known);
        this.updateAccess(subscription, accessible);
        const seen = new Set<string>();
        for (const change of changeSet.changes) {
          if (!subscription.complete.has(change.scope)) continue;
          const key = JSON.stringify([change.scope, change.type, change.id]);
          if (seen.has(key)) continue;
          seen.add(key);
          const entity = this.entities.get(change.type);
          if (!entity) throw new AppError("E_INTERNAL", `同步数据类型未注册`);
          const row = entity.read(change.scope, change.id);
          if (!row)
            throw new AppError("E_INTERNAL", "同步记录缺失，请稍后重试");
          if (
            row.type !== change.type ||
            row.id !== change.id ||
            row.rev !== changeSet.rev
          ) {
            throw new AppError(
              "E_INTERNAL",
              "同步变更与记录不一致，请稍后重试",
            );
          }
          const scope = response.scopes[change.scope] ?? {
            rows: [],
            cursor: changeSet.rev,
            more: false,
          };
          response.scopes[change.scope] = {
            ...scope,
            rows: [...scope.rows, this.serialize(row, changeSet.rev)],
          };
        }
        for (const [id, scope] of Object.entries(response.scopes))
          response.scopes[id] = {
            ...scope,
            rows: [...scope.rows].sort(compareRows),
          };
        this.emit(subscription, response);
      } catch (error) {
        this.report(error);
        this.requirePull(subscription);
      }
    }
  }

  /** Call after binding changes or authorization changes without a row mutation. */
  refreshAccess(): void {
    for (const subscription of this.subscriptions.values()) {
      try {
        const accessible = this.scopes(subscription.user);
        const response = this.response(accessible, subscription.known);
        this.updateAccess(subscription, accessible);
        this.emit(subscription, response);
      } catch (error) {
        this.report(error);
        this.requirePull(subscription);
      }
    }
  }

  unsubscribe(connectionId: string): void {
    this.subscriptions.delete(connectionId);
    this.transfers.delete(`connection:${connectionId}`);
  }
  clear(): void {
    this.subscriptions.clear();
    this.transfers.clear();
  }

  private continueTransfer(
    user: string,
    key: string,
    token?: string,
  ): SyncResponse {
    const transfer = this.transfers.get(key);
    if (
      !transfer ||
      transfer.user !== user ||
      (token && token !== transfer.token)
    )
      throw new AppError("E_CONFLICT", "同步分页已失效，请重新同步");
    const accessible = this.scopes(user);
    if ([...transfer.scopes].some((scope) => !accessible.has(scope))) {
      this.transfers.delete(key);
      throw new AppError("E_CONFLICT", "同步权限已变更，请重新同步");
    }
    if (accessible.size !== transfer.scopes.size) transfer.dirty = true;
    // A consumed continuation cannot silently skip a fragment if retried.
    if (token) transfer.token = randomUUID();
    transfer.expires = (this.options.now ?? Date.now)() + 60_000;
    const response = (length: number): SyncResponse => ({
      scopes: {},
      gone: [],
      added: [],
      ...(transfer.dirty && transfer.offset + length === transfer.json.length
        ? { repull: true }
        : {}),
      transfer: {
        token: transfer.token,
        chunk: transfer.json.slice(transfer.offset, transfer.offset + length),
        more: transfer.offset + length < transfer.json.length,
      },
    });
    // Count the full JSON envelope, including escaping and multi-byte text.
    let lo = 0,
      hi = Math.min(MAX_SYNC_BYTES, transfer.json.length - transfer.offset);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (utf8Encode(JSON.stringify(response(mid))).length <= MAX_SYNC_BYTES)
        lo = mid;
      else hi = mid - 1;
    }
    const result = response(lo);
    transfer.offset += lo;
    if (!result.transfer!.more) {
      this.transfers.delete(key);
      if (!transfer.dirty && transfer.subscription)
        transfer.subscription.complete = transfer.complete;
    }
    return result;
  }

  private requirePull(subscription: Subscription): void {
    // Never allow a later small delta to skip a failed/oversized earlier delta.
    subscription.complete.clear();
    const transfer = this.transfers.get(
      `connection:${subscription.connection.id}`,
    );
    if (transfer) transfer.dirty = true;
    try {
      subscription.connection.emit("sync.delta", {
        scopes: {},
        gone: [],
        added: [],
        repull: true,
      });
    } catch (error) {
      this.report(error);
    }
  }

  private select(
    user: string,
    scope: string,
    cursor: number,
    limit: number,
    revision: number,
  ): { rows: Row[]; reset: string[] } {
    const retained = new Map<string, Row[]>();
    const counts = new Map<string, number>();
    const reset = new Set<string>();
    for (const provider of this.providers) {
      if (!provider.match(scope) || !provider.access(user, scope)) continue;
      for (const batch of this.batches(provider, scope, cursor, revision)) {
        const touched = new Set<string>();
        for (const row of batch) {
          const count = (counts.get(row.type) ?? 0) + 1;
          counts.set(row.type, count);
          if (
            this.entities.get(row.type)?.windowed &&
            count > this.resetThreshold
          ) {
            reset.add(row.type);
            retained.delete(row.type);
          }
          if (reset.has(row.type)) continue;
          const rows = retained.get(row.type) ?? [];
          rows.push(row);
          retained.set(row.type, rows);
          touched.add(row.type);
        }
        for (const type of touched) {
          const rows = retained.get(type);
          if (!rows) continue;
          rows.sort(compareRows);
          // Keep one complete page plus the next revision group for `more`.
          // Keeping candidates per type lets a later window reset remove that
          // type without hiding ordinary rows which belong on the first page.
          if (rows.length > limit) {
            const boundary = rows[limit - 1]!.rev;
            const next = rows.find((row) => row.rev > boundary)?.rev;
            if (next !== undefined) {
              const end = rows.findIndex((row) => row.rev > next);
              if (end !== -1) rows.length = end;
            }
          }
        }
      }
    }
    const rows = [...retained.values()].flat().sort(compareRows);
    const identities = new Set<string>();
    for (const row of rows) {
      const key = JSON.stringify([row.type, row.id]);
      if (identities.has(key))
        throw new AppError("E_INTERNAL", "同步记录重复，请稍后重试");
      identities.add(key);
    }
    return { rows, reset: [...reset].sort() };
  }

  private *batches(
    provider: ScopeProvider,
    scope: string,
    since: number,
    revision: number,
  ): Generator<readonly Row[]> {
    let cursor = since;
    let size = Math.max(
      Math.min(Number.MAX_SAFE_INTEGER, this.pageSize + 1),
      256,
    );
    for (;;) {
      const rows = provider.select(scope, cursor, size);
      let previous = cursor;
      const identities = new Set<string>();
      for (const row of rows) {
        this.validateRow(row, revision);
        const identity = JSON.stringify([row.type, row.id]);
        if (identities.has(identity))
          throw new AppError("E_INTERNAL", "同步记录重复，请稍后重试");
        identities.add(identity);
        if (
          !Number.isSafeInteger(row.rev) ||
          row.rev <= cursor ||
          row.rev < previous
        ) {
          throw new AppError("E_INTERNAL", "同步数据顺序异常，请稍后重试");
        }
        previous = row.rev;
      }
      if (rows.length < size) {
        if (rows.length) yield rows;
        return;
      }
      const lastRev = rows[rows.length - 1]!.rev;
      const boundary = rows.findIndex((row) => row.rev === lastRev);
      if (boundary > 0) {
        // SQL LIMIT may split the final transaction. Re-read that revision in
        // the next query rather than advancing a cursor through half a group.
        const complete = rows.slice(0, boundary);
        yield complete;
        cursor = complete[complete.length - 1]!.rev;
        size = Math.max(
          Math.min(Number.MAX_SAFE_INTEGER, this.pageSize + 1),
          256,
        );
      } else {
        // One transaction may exceed a page; its full group is indivisible.
        if (size === Number.MAX_SAFE_INTEGER)
          throw new AppError("E_TOO_LARGE", "单次同步变更过大，请联系管理员");
        size = Math.min(Number.MAX_SAFE_INTEGER, size * 2);
      }
    }
  }

  private validateRow(row: Row, revision: number): void {
    if (!this.entities.has(row.type)) {
      throw new AppError("E_INTERNAL", "同步数据类型未注册");
    }
    if (
      typeof row.id !== "string" ||
      row.id.length === 0 ||
      typeof row.deleted !== "boolean" ||
      !Number.isSafeInteger(row.rev) ||
      row.rev < 1 ||
      row.rev > revision
    ) {
      throw new AppError("E_INTERNAL", "同步记录版本或标识异常，请稍后重试");
    }
  }

  private serialize(row: Row, revision: number): Row {
    this.validateRow(row, revision);
    const entity = this.entities.get(row.type);
    if (!entity) throw new AppError("E_INTERNAL", `同步数据类型未注册`);
    const result = entity.serialize(row);
    if (
      result.type !== row.type ||
      result.id !== row.id ||
      result.rev !== row.rev ||
      result.deleted !== row.deleted
    ) {
      throw new AppError("E_INTERNAL", "同步记录标识异常，请稍后重试");
    }
    return result;
  }

  private scopes(user: string): Set<string> {
    const scopes = new Set<string>();
    for (const provider of this.providers) {
      for (const scope of provider.list(user)) {
        if (provider.match(scope) && provider.access(user, scope))
          scopes.add(scope);
      }
    }
    for (const scope of scopes) {
      for (const provider of this.providers) {
        if (provider.match(scope) && !provider.access(user, scope)) {
          scopes.delete(scope);
          break;
        }
      }
    }
    return scopes;
  }

  private response(accessible: Set<string>, known: Set<string>): SyncResponse {
    return {
      scopes: Object.create(null) as Record<string, ScopePull>,
      gone: [...known].filter((scope) => !accessible.has(scope)).sort(),
      added: [...accessible].filter((scope) => !known.has(scope)).sort(),
    };
  }

  private updateAccess(
    subscription: Subscription,
    accessible: Set<string>,
  ): void {
    subscription.known = accessible;
    for (const scope of subscription.complete)
      if (!accessible.has(scope)) subscription.complete.delete(scope);
  }

  private emit(subscription: Subscription, response: SyncResponse): void {
    if (
      response.gone.length ||
      response.added.length ||
      Object.keys(response.scopes).length
    ) {
      if (utf8Encode(JSON.stringify(response)).length > MAX_SYNC_BYTES) {
        this.requirePull(subscription);
        return;
      }
      subscription.connection.emit("sync.delta", response);
    }
  }
  private report(error: unknown): void {
    try {
      this.options.reportError?.(error);
    } catch {
      /* Incident reporting cannot break fan-out. */
    }
  }
  private positive(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new AppError("E_INVALID", `${name}必须是正整数`);
  }
}

function compareRows(left: Row, right: Row): number {
  return (
    left.rev - right.rev ||
    (left.type < right.type
      ? -1
      : left.type > right.type
        ? 1
        : left.id < right.id
          ? -1
          : left.id > right.id
            ? 1
            : 0)
  );
}
