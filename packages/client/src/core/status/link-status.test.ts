import { describe, expect, it, vi } from "vitest";
import { Emitter } from "@talos/base";
import type { ClientState, LinkClient } from "@talos/link";
import { LinkConnectionStore, toStatusConnection } from "./link-status.ts";

class FakeClient implements Pick<LinkClient, "state" | "onState"> {
  state: ClientState = "idle";
  readonly states = new Emitter<ClientState>();
  readonly detach = vi.fn();
  onState(listener: (state: ClientState) => void): () => void {
    const off = this.states.on(listener);
    return () => {
      this.detach();
      off();
    };
  }
  change(state: ClientState): void {
    this.state = state;
    this.states.emit(state);
  }
}

describe("link connection projection", () => {
  it.each([
    ["idle", "offline"],
    ["connecting", "connecting"],
    ["open", "connected"],
    ["waiting", "offline"],
    ["versionMismatch", "offline"],
    ["stopped", "offline"],
  ] as const)("maps %s to %s", (state, expected) => {
    expect(toStatusConnection(state)).toBe(expected);
  });

  it("hydrates the current state and publishes reconnect transitions without duplicates", () => {
    const client = new FakeClient();
    client.state = "open";
    const store = new LinkConnectionStore(client);
    const snapshots: string[] = [];
    const off = store.subscribe(() => snapshots.push(store.getSnapshot()));
    expect(store.getSnapshot()).toBe("connected");
    client.change("waiting");
    client.change("waiting");
    client.change("connecting");
    client.change("open");
    expect(snapshots).toEqual(["offline", "connecting", "connected"]);
    off();
    client.change("stopped");
    expect(snapshots).toHaveLength(3);
    store.dispose();
  });

  it("supports extracted React subscription functions and independent clients", () => {
    const firstClient = new FakeClient();
    const secondClient = new FakeClient();
    const first = new LinkConnectionStore(firstClient);
    const second = new LinkConnectionStore(secondClient);
    const { getSnapshot, subscribe } = first;
    const listener = vi.fn();
    const off = subscribe(listener);
    firstClient.change("connecting");
    expect(getSnapshot()).toBe("connecting");
    expect(listener).toHaveBeenCalledOnce();
    expect(second.getSnapshot()).toBe("offline");
    off();
    first.dispose();
    second.dispose();
  });

  it("detaches once, rejects new subscribers after disposal, and ignores late events", () => {
    const client = new FakeClient();
    const store = new LinkConnectionStore(client);
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispose();
    store.dispose();
    client.change("open");
    expect(client.detach).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe("offline");
    expect(() => store.subscribe(listener)).toThrow(
      expect.objectContaining({ code: "E_CANCELLED" }),
    );
  });

  it("captures a synchronous transition during subscription", () => {
    let state: ClientState = "idle";
    const client: Pick<LinkClient, "state" | "onState"> = {
      get state() {
        return state;
      },
      onState() {
        state = "open";
        return () => {};
      },
    };
    const store = new LinkConnectionStore(client);
    expect(store.getSnapshot()).toBe("connected");
    store.dispose();
  });

  it("isolates a throwing observer so other UI subscribers still update", () => {
    const client = new FakeClient();
    const store = new LinkConnectionStore(client);
    const listener = vi.fn();
    store.subscribe(() => {
      throw new Error("view error");
    });
    store.subscribe(listener);
    client.change("open");
    expect(listener).toHaveBeenCalledOnce();
    store.dispose();
  });
});
