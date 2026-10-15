import { WAIT_TIMEOUT } from "./wait.mjs";

/** Production binary link client used only for deterministic E2E seed/admin calls. */
export async function connectChat(url, pin) {
  const socket = new WebSocket(url.replace(/^http/, "ws") + "/link");
  socket.binaryType = "arraybuffer";
  let next = 0;
  const pending = new Map();
  function send(type, header, body = new Uint8Array()) {
    const json = Buffer.from(JSON.stringify(header));
    const frame = Buffer.alloc(5 + json.length + body.length);
    frame[0] = type;
    frame.writeUInt32BE(json.length, 1);
    json.copy(frame, 5);
    frame.set(body, 5 + json.length);
    socket.send(frame);
  }
  let welcome;
  let rejectReady;
  let welcomeTimer;
  const ready = new Promise((resolve, reject) => {
    welcome = resolve;
    rejectReady = reject;
    welcomeTimer = setTimeout(() => {
      reject(new Error("Chat seed handshake timed out"));
      socket.close();
    }, WAIT_TIMEOUT);
    socket.addEventListener("error", () =>
      reject(new Error("Chat seed connection failed")),
    );
  });
  socket.addEventListener("open", () =>
    send(1, { v: 1, build: "e2e", device: null, lang: "zh-CN" }),
  );
  socket.addEventListener("message", (event) => {
    const frame = Buffer.from(event.data);
    const size = frame.readUInt32BE(1);
    const header = JSON.parse(frame.subarray(5, 5 + size).toString("utf8"));
    if (frame[0] === 2) {
      clearTimeout(welcomeTimer);
      welcome(header);
    } else if (frame[0] === 6) send(7, header);
    else if (frame[0] === 4) {
      const request = pending.get(header.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(header.id);
      if (header.ok)
        request.resolve({ data: header.d, body: frame.subarray(5 + size) });
      else request.reject(Object.assign(new Error(header.e.message), header.e));
    }
  });
  socket.addEventListener("close", () => {
    clearTimeout(welcomeTimer);
    rejectReady(new Error("Chat seed connection closed"));
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Chat seed connection closed"));
    }
    pending.clear();
  });
  await ready;
  function call(method, args, body) {
    const id = ++next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Chat seed call timed out: ${method}`));
      }, WAIT_TIMEOUT);
      pending.set(id, { resolve, reject, timer });
      send(3, { id, m: method, a: args }, body);
    });
  }
  try {
    await call("auth.device.register", { label: "社区 E2E" });
    const session = (await call("auth.login", { pin })).data;
    return { call, user: session.user, close: () => socket.close() };
  } catch (error) {
    socket.close();
    throw error;
  }
}
