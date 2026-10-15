import { AppError, Emitter } from "@talos/base";
import type { Carrier, CarrierClose } from "./carrier.ts";
import { duration, systemTimers } from "./runtime.ts";
import type { Timers } from "./runtime.ts";
export interface MemoryCarrier extends Carrier {
  readonly listenerCount: number;
}
export interface MemoryCarrierPair {
  a: MemoryCarrier;
  b: MemoryCarrier;
  readonly pending: number;
  deliver(index?: number): boolean;
  drop(index?: number): boolean;
  close(code?: number, reason?: string): void;
}
export interface MemoryCarrierOptions {
  latencyMs?: number;
  /** A fake scheduler can serve as the memory carrier's clock. */
  clock?: Timers;
  manual?: boolean;
}
export function createMemoryCarrierPair(
  options: MemoryCarrierOptions = {},
): MemoryCarrierPair {
  const timers = options.clock ?? systemTimers;
  const latency = duration(options.latencyMs ?? 0);
  const messages = [new Emitter<Uint8Array>(), new Emitter<Uint8Array>()];
  const closes = [new Emitter<CarrierClose>(), new Emitter<CarrierClose>()];
  const counts = [0, 0];
  let closed: CarrierClose | undefined;
  const queue: { to: number; bytes: Uint8Array; timer?: unknown }[] = [];
  function remove(index: number, deliver: boolean): boolean {
    const item = queue.splice(index, 1)[0];
    if (!item) return false;
    timers.clearTimeout(item.timer);
    if (deliver && !closed) messages[item.to]!.emit(item.bytes);
    return true;
  }
  function close(code?: number, reason?: string): void {
    if (closed) return;
    closed = { code, reason };
    while (queue.length) remove(0, false);
    for (const emitter of closes) emitter.emit(closed);
  }
  function endpoint(index: number): MemoryCarrier {
    return {
      send(bytes) {
        if (closed) throw new AppError("E_DISCONNECTED", "连接已断开");
        const item = {
          to: 1 - index,
          bytes: bytes.slice(),
          timer: undefined as unknown,
        };
        queue.push(item);
        if (!options.manual)
          item.timer = timers.setTimeout(() => {
            const i = queue.indexOf(item);
            if (i >= 0) remove(i, true);
          }, latency);
      },
      close(code, reason) {
        while (queue.length && !closed) remove(0, true);
        close(code, reason);
      },
      onMessage(listener) {
        counts[index]!++;
        const off = messages[index]!.on(listener);
        let active = true;
        return () => {
          if (active) {
            active = false;
            counts[index]!--;
            off();
          }
        };
      },
      onClose(listener) {
        if (closed) {
          listener(closed);
          return () => {};
        }
        counts[index]!++;
        const off = closes[index]!.on(listener);
        let active = true;
        return () => {
          if (active) {
            active = false;
            counts[index]!--;
            off();
          }
        };
      },
      get bufferedAmount() {
        return queue
          .filter((item) => item.to !== index)
          .reduce((n, item) => n + item.bytes.length, 0);
      },
      get listenerCount() {
        return counts[index]!;
      },
    };
  }
  return {
    a: endpoint(0),
    b: endpoint(1),
    get pending() {
      return queue.length;
    },
    deliver: (i = 0) => remove(i, true),
    drop: (i = 0) => remove(i, false),
    close,
  };
}
