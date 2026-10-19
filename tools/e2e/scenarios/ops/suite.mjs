import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";
import { SCREENSHOTS } from "../../harness/artifacts.mjs";
import { ROOT } from "../../harness/static-server.mjs";
/** What each panel must show for the gallery fixture, and one control that needs the server. */
const PANELS = {
  update: { shows: ["2026-10-13"], action: "检查云端版本" },
  backup: { shows: ["01ARZ3NDEKTSV4RRFFQ69G5FAV", "MiB"], action: "创建备份" },
  https: {
    shows: ["talos.school.example", "HTTPS · 8443", "HTTP · 8080"],
    action: "刷新",
  },
  host: { shows: ["重置教学环境", "立即关机", "定时关机"], action: "定时关机" },
  office: { shows: ["高三语文复习资料", "WPS 文字"], action: "捕获当前文档" },
};
const controlState = (label) =>
  `(function(){var b=Array.prototype.slice.call(document.querySelectorAll('button')).find(function(n){return n.textContent.trim()===${JSON.stringify(label)}});return b?(b.disabled?'disabled':'enabled'):'missing'})()`;

export async function opsSuite(browser, server, { legacy = false } = {}) {
  const { cdp } = browser;
  for (const panel of ["update", "backup", "https", "host", "office"]) {
    for (const theme of ["light", "dark"]) {
      for (const [width, height] of [
        [1280, 800],
        [768, 1024],
      ]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await cdp.navigate(
          `${server.url}/gallery.html?ops=${panel}&theme=${theme}`,
        );
        await cdp.wait(
          "!!document.querySelector('[data-testid=\"ops.panel\"]') && document.body.textContent.indexOf('加载中')<0",
        );
        for (const shown of PANELS[panel].shows)
          assert.equal(
            await cdp.evaluate(
              `document.body.textContent.indexOf(${JSON.stringify(shown)})>=0`,
            ),
            true,
            `${panel} panel shows ${shown}`,
          );
        assert.notEqual(
          await cdp.evaluate(controlState(PANELS[panel].action)),
          "missing",
          `${panel} panel offers ${PANELS[panel].action}`,
        );
        await cdp.evaluate(
          "document.fonts ? document.fonts.ready.then(function(){return true;}) : true",
        );
        assert.equal(
          await cdp.evaluate(
            "document.documentElement.scrollWidth<=innerWidth",
          ),
          true,
          `${panel} no horizontal overflow`,
        );
        await cdp.screenshot(
          path.join(
            SCREENSHOTS,
            `${legacy ? "chrome70" : "chromium"}-ops-${panel}-${theme}-${width}x${height}.png`,
          ),
        );
      }
    }
    await cdp.navigate(`${server.url}/gallery.html?ops=${panel}&offline=1`);
    await cdp.wait("document.body.textContent.indexOf('离线不可用')>=0");
    // Offline, a server action is either withheld or disabled - never offered.
    assert.notEqual(
      await cdp.evaluate(controlState(PANELS[panel].action)),
      "enabled",
      `${panel} server action is not offered offline`,
    );
  }
  console.log(
    `${legacy ? "Chrome 70" : "Chromium"}: five ops panels, offline states, 20 screenshots passed`,
  );
}

export async function packagedOpsSuite() {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(ROOT, "tools/package/e2e.mjs")],
      { cwd: ROOT, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Packaged ops E2E exited ${code}`));
    });
  });
}
