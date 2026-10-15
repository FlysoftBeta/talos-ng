import { createHash } from "node:crypto";

/**
 * Failure ceiling for every condition wait. Waits return the moment the condition holds, so the
 * ceiling only decides how much host load a scenario tolerates before it is called stuck.
 */
export const WAIT_TIMEOUT = 45_000;

export async function eventually(
  read,
  accept,
  description,
  timeout = WAIT_TIMEOUT,
) {
  const deadline = Date.now() + timeout;
  let result;
  do {
    result = await read();
    if (accept(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error(
    `Timed out: ${description}; last value ${JSON.stringify(result)}`,
  );
}

export function fixtureBuild(server, build) {
  const assetPath = `/app/${build}/index.html`;
  const bytes = Buffer.from(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Talos II 测试构建</title><body><main data-testid="fixture-ready" data-build="${build}">构建 ${build}</main></body></html>`,
  );
  server.overrides.set(assetPath, { bytes, mime: "text/html" });
  return {
    build,
    assets: [
      {
        path: assetPath,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mime: "text/html",
      },
    ],
  };
}

export function swMessage(message) {
  return `new Promise(function(resolve,reject) { var channel = new MessageChannel(); var timer = setTimeout(function(){reject(new Error('SW message timeout'));},${WAIT_TIMEOUT}); channel.port1.onmessage = function(event) { clearTimeout(timer); channel.port1.close(); if (event.data && event.data.error) reject(new Error(JSON.stringify(event.data.error))); else resolve(event.data); }; navigator.serviceWorker.controller.postMessage(${JSON.stringify(message)},[channel.port2]); })`;
}

/** Same production boot/offline/gallery/virtual-scroll checks run on both browser engines. */
