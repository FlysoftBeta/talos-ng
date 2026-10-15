import assert from "node:assert/strict";
import { test } from "vitest";
import { CdpClient } from "./cdp.mjs";

class Socket extends EventTarget {
  sent = [];
  send(value) {
    this.sent.push(JSON.parse(value));
  }
  receive(value) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }
  close() {
    this.dispatchEvent(new Event("close"));
  }
}

test("CDP pairs out-of-order requests and dispatches removable event listeners", async () => {
  const socket = new Socket();
  const cdp = new CdpClient(socket);
  const first = cdp.send("first");
  const second = cdp.send("second");
  socket.receive({ id: 2, result: { value: 2 } });
  socket.receive({ id: 1, result: { value: 1 } });
  assert.deepEqual(await first, { value: 1 });
  assert.deepEqual(await second, { value: 2 });
  const events = [];
  const off = cdp.on("event", (value) => events.push(value));
  socket.receive({ method: "event", params: 7 });
  off();
  socket.receive({ method: "event", params: 8 });
  assert.deepEqual(events, [7]);
  cdp.close();
});
test("CDP surfaces protocol errors and rejects outstanding requests on close", async () => {
  const socket = new Socket();
  const cdp = new CdpClient(socket);
  const failure = assert.rejects(cdp.send("bad"), /invalid method/);
  socket.receive({ id: 1, error: { message: "invalid method" } });
  await failure;
  const closed = assert.rejects(cdp.send("waiting"), /closed/);
  socket.close();
  await closed;
});
test("CDP evaluate reports browser exceptions", async () => {
  const socket = new Socket();
  const cdp = new CdpClient(socket);
  const failure = assert.rejects(
    cdp.evaluate("throw Error()"),
    /browser failure/,
  );
  socket.receive({
    id: 1,
    result: {
      exceptionDetails: { exception: { description: "browser failure" } },
    },
  });
  await failure;
  cdp.close();
});
test("CDP request timeout is bounded", async () => {
  const cdp = new CdpClient(new Socket(), 5);
  await assert.rejects(cdp.send("lost"), /timeout: lost/);
  cdp.close();
});
