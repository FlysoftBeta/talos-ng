import assert from "node:assert/strict";
import { fixtureBuild, swMessage } from "../../harness/wait.mjs";

export async function updateSuite(browser, server) {
  const { cdp } = browser;
  const good = fixtureBuild(server, "e2e-confirmed");
  const bad = fixtureBuild(server, "e2e-unconfirmed");
  const corrupt = fixtureBuild(server, "e2e-corrupt");
  corrupt.assets[0].sha256 = "0".repeat(64);
  const rejected = await cdp.evaluate(
    `window.__talosShell.install(${JSON.stringify(corrupt)}).then(function(){return false;},function(){return true;})`,
  );
  assert.equal(
    rejected,
    true,
    "Integrity mismatch rejected before publication",
  );
  let status = await cdp.evaluate("window.__talosShell.status()");
  assert.notEqual(status.pending, corrupt.build);
  assert.ok(
    !status.builds.some(
      (build) => build.manifest.build === corrupt.build && build.complete,
    ),
  );
  // Retain a second complete fixture so the later bad-boot activation uses the public SW API.
  await cdp.evaluate(`window.__talosShell.install(${JSON.stringify(bad)})`);
  await cdp.evaluate(`window.__talosShell.install(${JSON.stringify(good)})`);
  status = await cdp.evaluate("window.__talosShell.status()");
  assert.equal(status.pending, good.build);
  await cdp.evaluate(
    `window.__talosShell.apply(${JSON.stringify(good.build)})`,
  );
  await cdp.navigate(`${server.url}/`);
  await cdp.wait(`!!document.querySelector('[data-build="${good.build}"]')`);
  await cdp.evaluate(swMessage({ type: "confirmBoot", build: good.build }));
  status = unwrapStatus(await cdp.evaluate(swMessage({ type: "status" })));
  assert.equal(status.active, good.build);
  assert.equal(status.bootAttempts, 0);
  await cdp.evaluate(swMessage({ type: "activate", build: bad.build }));
  for (let attempt = 1; attempt <= 2; attempt++) {
    await cdp.navigate(`${server.url}/`);
    await cdp.wait(`!!document.querySelector('[data-build="${bad.build}"]')`);
    status = unwrapStatus(await cdp.evaluate(swMessage({ type: "status" })));
    assert.equal(status.bootAttempts, attempt);
  }
  await cdp.navigate(`${server.url}/`);
  await cdp.wait(`!!document.querySelector('[data-build="${good.build}"]')`);
  status = unwrapStatus(await cdp.evaluate(swMessage({ type: "status" })));
  assert.equal(
    status.active,
    good.build,
    "Two unconfirmed boots roll back to last working build",
  );
  assert.deepEqual(
    browser.errors.filter(
      (message) => !/WebSocket connection to .*\/link.*failed/.test(message),
    ),
    [],
  );
}

function unwrapStatus(response) {
  return response.value || response.status || response;
}
