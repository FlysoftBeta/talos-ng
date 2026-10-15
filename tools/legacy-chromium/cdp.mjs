import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Minimal version-independent CDP transport with bounded requests and disconnect cleanup. */
export class CdpClient {
  #next = 0;
  #pending = new Map();
  #listeners = new Map();
  constructor(socket, timeout = 30_000) {
    this.socket = socket;
    this.timeout = timeout;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const request = this.#pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        this.#pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      } else
        for (const listener of this.#listeners.get(message.method) || [])
          listener(message.params);
    });
    socket.addEventListener("close", () =>
      this.#rejectAll(new Error("CDP connection closed")),
    );
    socket.addEventListener("error", () =>
      this.#rejectAll(new Error("CDP connection failed")),
    );
  }
  #rejectAll(error) {
    for (const request of this.#pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.#pending.clear();
  }
  send(method, params = {}) {
    const id = ++this.#next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, this.timeout);
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }
  on(method, listener) {
    const set = this.#listeners.get(method) || new Set();
    set.add(listener);
    this.#listeners.set(method, set);
    return () => set.delete(listener);
  }
  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails)
      throw new Error(
        response.exceptionDetails.exception?.description ||
          response.exceptionDetails.text,
      );
    return response.result.value;
  }
  async wait(expression, timeout = 20_000) {
    await this.evaluate(
      `new Promise(function(resolve, reject) { var end = Date.now() + ${timeout}; function check() { try { if (${expression}) return resolve(true); } catch (_) {} if (Date.now() >= end) return reject(new Error("Condition timed out: " + ${JSON.stringify(expression)})); setTimeout(check, 25); } check(); })`,
    );
  }
  async navigate(url) {
    let remove;
    let timer;
    const loaded = new Promise((resolve, reject) => {
      remove = this.on("Page.loadEventFired", resolve);
      timer = setTimeout(
        () => reject(new Error(`Page load timed out: ${url}`)),
        this.timeout,
      );
    });
    try {
      const result = await this.send("Page.navigate", { url });
      if (result.errorText)
        throw new Error(`Navigation failed: ${result.errorText}`);
      await loaded;
      await this.wait(
        `document.readyState === 'complete' && location.href === ${JSON.stringify(url)}`,
      );
    } finally {
      clearTimeout(timer);
      remove();
    }
  }
  async screenshot(file) {
    const result = await this.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(result.data, "base64"));
  }
  async offline(enabled) {
    await this.send("Network.emulateNetworkConditions", {
      offline: enabled,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  }
  close() {
    this.#rejectAll(new Error("CDP client closed"));
    this.socket.close();
  }
}

export async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("CDP connect timeout"));
    }, 15_000);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error(`Cannot connect to ${url}`));
      },
      { once: true },
    );
  });
  return new CdpClient(socket);
}

export async function launchChrome(executable) {
  const profile = await mkdtemp(path.join(tmpdir(), "talos-chromium-"));
  const child = spawn(
    executable,
    [
      "--headless",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--no-first-run",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let cdp;
  const stop = async () => {
    cdp?.close();
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill("SIGTERM");
      });
    }
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  };
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error(`Chromium startup timeout: ${output}`)),
        20_000,
      );
      child.stderr.on("data", (chunk) => {
        output += String(chunk);
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Chromium exited ${code}: ${output}`));
      });
    });
    const origin = endpoint.replace(/^ws:/, "http:").split("/devtools/")[0];
    // The DevTools endpoint is announced before the first page target is listed; poll for it.
    let page;
    for (const deadline = Date.now() + 20_000; !page;) {
      const pages = await fetch(`${origin}/json/list`).then((response) =>
        response.json(),
      );
      page = pages.find((candidate) => candidate.type === "page");
      if (page) break;
      if (Date.now() > deadline)
        throw new Error("Chromium exposed no page target");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    const errors = [];
    const consoleMessages = [];
    cdp.on("Runtime.exceptionThrown", (event) =>
      errors.push(
        event.exceptionDetails.exception?.description ||
          event.exceptionDetails.text,
      ),
    );
    cdp.on("Runtime.consoleAPICalled", (event) => {
      const message = event.args
        .map((arg) => arg.value ?? arg.description)
        .join(" ");
      consoleMessages.push({ type: event.type, message });
      if (event.type === "error") errors.push(message);
    });
    cdp.on("Log.entryAdded", ({ entry }) => {
      if (entry.level === "error")
        errors.push(`${entry.text} (${entry.url || entry.source})`);
    });
    await Promise.all(
      ["Runtime.enable", "Page.enable", "Network.enable", "Log.enable"].map(
        (method) => cdp.send(method),
      ),
    );
    return { cdp, errors, consoleMessages, close: stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
