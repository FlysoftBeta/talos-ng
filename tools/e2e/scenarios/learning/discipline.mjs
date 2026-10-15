import { eventually, WAIT_TIMEOUT } from "../../harness/wait.mjs";
import {
  text,
  app,
  locked,
  click,
  pin,
  reveal,
  select,
  captures,
  closeSheet,
  connected,
} from "../../harness/ui.mjs";

export async function disciplineScenarios(cdp, server, name) {
  await cdp.navigate(`${server.url}/`);
  await cdp.wait(locked);
  await reveal(cdp);
  await connected(cdp);
  await click(cdp, "清除");
  await pin(cdp, "654321");
  await cdp.wait(app);
  await connected(cdp);
  await click(cdp, "设置");
  await select(cdp, "主题", "dark");
  await select(cdp, "自动锁定", "15");
  await closeSheet(cdp);
  await click(cdp, "学习");
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"learning.stats\"]')",
  );
  await captures(cdp, name, "dark", "learning-dashboard");
  await select(cdp, "自律模式", "开启");
  await eventually(
    () => server.readSetting("learning.discipline"),
    (value) => value === true,
    "discipline setting synced",
  );
  await cdp.wait(
    "!!document.querySelector('[role=group][aria-label=\"自律模式\"] button[aria-pressed=true]:last-child')",
  );
  await click(cdp, "AI");
  const advanced = new Promise((resolve) =>
    cdp.on("Emulation.virtualTimeBudgetExpired", resolve),
  );
  await cdp.send("Emulation.setVirtualTimePolicy", {
    policy: "advance",
    budget: 300_100,
  });
  await Promise.race([
    advanced,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Virtual time did not advance")),
        WAIT_TIMEOUT,
      ),
    ),
  ]);
  await cdp.send("Emulation.setVirtualTimePolicy", { policy: "advance" });
  await cdp.wait(`${text}.indexOf('自律时刻 · 练习一题')>=0`);
  await cdp.send("Emulation.setVirtualTimePolicy", { policy: "pause" });
  await captures(cdp, name, "dark", "learning-discipline", false);
  return 1;
}
