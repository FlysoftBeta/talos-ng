import assert from "node:assert/strict";
import { eventually } from "../../harness/wait.mjs";
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
import { fill, logout } from "./helpers.mjs";

export async function identityScenarios(cdp, server, name) {
  let cases = 0;
  await pin(cdp, "654321");
  await cdp.wait(app);
  await logout(cdp);
  assert.equal(server.sessionCount(), 0, "logout revokes server session");
  await pin(cdp, "123456");
  await cdp.wait(app);
  await connected(cdp);
  await click(cdp, "管理");
  await click(cdp, "运维 · 备份");
  await cdp.wait(`${text}.indexOf('保留份数')>=0`);
  const backupCount =
    "Array.prototype.slice.call(document.querySelectorAll('button')).filter(function(b){var l=b.getAttribute('aria-label')||'';return l.indexOf('备份 ')===0&&l.slice(-3)==='的操作';}).length";
  const beforeBackups = await cdp.evaluate(backupCount);
  await click(cdp, "创建备份");
  await cdp.wait(`${backupCount}===${beforeBackups + 1}`);
  await captures(cdp, name, "light", "ops-backup");
  await cdp.offline(true);
  await cdp.wait(`${text}.indexOf('离线不可用')>=0`);
  assert.equal(
    await cdp.evaluate(
      "Array.prototype.slice.call(document.querySelectorAll('button')).some(function(b){return b.textContent.trim()==='创建备份';})",
    ),
    false,
    "ops backup creation is unavailable offline",
  );
  await cdp.offline(false);
  await cdp.wait(`${text}.indexOf('MiB ·')>=0`);
  await cdp.evaluate(
    "(function(){var b=Array.prototype.slice.call(document.querySelectorAll('button')).filter(function(b){var l=b.getAttribute('aria-label')||'';return l.indexOf('备份 ')===0&&l.slice(-3)==='的操作';})[0];b.click();})()",
  );
  await click(cdp, "删除");
  await cdp.wait(`${text}.indexOf('确认「删除备份')>=0`);
  await click(cdp, "确认");
  await cdp.wait(`${backupCount}===${beforeBackups}`);
  await click(cdp, "邀请");
  cases += 2;
  await click(cdp, "创建邀请");
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"admin.invitations.pin\"]')",
  );
  const invitation = await cdp.evaluate(
    "document.querySelector('[data-testid=\"admin.invitations.pin\"]').textContent",
  );
  await captures(cdp, name, "light", "invitation");
  await logout(cdp);
  await pin(cdp, invitation);
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"auth.onboarding\"]')",
  );
  await captures(cdp, name, "light", "onboarding-pin");
  await pin(cdp, "135790");
  await click(cdp, "添加第二个 PIN");
  await pin(cdp, "246802");
  await fill(cdp, "账号标识", "new_member");
  await cdp.evaluate("document.querySelector('input[name=handle]').focus()");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter" });
  assert.equal(
    await cdp.evaluate("document.activeElement.name"),
    "displayName",
    "Enter advances from handle to display name",
  );
  await fill(cdp, "显示名称", "受邀新同学");
  await captures(cdp, name, "light", "onboarding-profile");
  await click(cdp, "完成并进入");
  await cdp.wait(app);
  await connected(cdp);
  assert.equal(server.readUser("new_member").name, "受邀新同学");
  cases++;
  await click(cdp, "锁定");
  await cdp.wait(locked);
  await reveal(cdp, true);
  await pin(cdp, "246802");
  await cdp.wait(app);
  cases++;
  await click(cdp, "设置");
  await click(cdp, "编辑资料");
  await fill(cdp, "显示名称", "资料已更新的同学");
  await click(cdp, "保存个人资料");
  await cdp.wait(`${text}.indexOf('个人资料已保存')>=0`);
  assert.equal(server.readUser("new_member").name, "资料已更新的同学");
  await click(cdp, "更换 PIN");
  await pin(cdp, "246802");
  await pin(cdp, "112233");
  await click(cdp, "只使用一个 PIN");
  await cdp.wait(`${text}.indexOf('PIN 已更换')>=0`);
  await captures(cdp, name, "light", "pin-replaced");
  await click(cdp, "完成");
  await closeSheet(cdp);
  await logout(cdp);
  await pin(cdp, "135790");
  await cdp.wait(`${text}.indexOf('PIN 不正确')>=0`);
  await pin(cdp, "112233");
  await cdp.wait(app);
  cases++;
  for (const theme of ["light", "dark"]) {
    await click(cdp, "设置");
    await select(cdp, "主题", theme);
    await eventually(
      () => server.readSetting("theme"),
      (value) => value === theme,
      "identity theme synced",
    );
    await click(cdp, "编辑资料");
    await captures(cdp, name, theme, "profile");
    await click(cdp, "关于");
    await cdp.wait(`${text}.indexOf('关于 Talos II')>=0`);
    await captures(cdp, name, theme, "about");
    await cdp.evaluate(
      "Array.prototype.slice.call(document.querySelectorAll('[role=dialog]')).pop().querySelector('button[aria-label=关闭]').click()",
    );
    await cdp.offline(true);
    await cdp.wait(`${text}.indexOf('离线')>=0`);
    assert.equal(
      await cdp.evaluate(
        "Array.prototype.slice.call(document.querySelectorAll('button')).find(function(e){return e.textContent==='保存个人资料';}).disabled",
      ),
      true,
      "profile editing disabled offline",
    );
    await captures(cdp, name, theme, "profile-offline");
    await cdp.evaluate(
      "document.querySelector('[role=switch][aria-label=免打扰]').click()",
    );
    await cdp.wait(`${text}.indexOf('待同步')>=0`);
    await cdp.offline(false);
    await connected(cdp);
    await eventually(
      () => server.readSetting("doNotDisturb"),
      (value) => value === (theme === "light"),
      "offline DND reaches server",
    );
    await closeSheet(cdp);
    cases++;
  }
  await cdp.evaluate("history.back()");
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"auth.concealed\"]')",
  );
  await pin(cdp, "112233");
  await cdp.wait(app);
  cases++;
  await logout(cdp);
  for (let i = 0; i < 5; i++) {
    await pin(cdp, "999999");
    if (i < 4)
      await cdp.wait(
        `${text}.indexOf('PIN 不正确')>=0 && !document.querySelector('[data-testid=\"auth.numpad\"] button:disabled')`,
      );
  }
  await cdp.wait("!!document.querySelector('[role=timer]')");
  const countdown = await cdp.evaluate(
    "document.querySelector('[role=timer]').textContent",
  );
  await cdp.wait(
    `document.querySelector('[role=timer]').textContent!==${JSON.stringify(countdown)}`,
  );
  await captures(cdp, name, "light", "throttled");
  server.fixtureDevice({ clearThrottle: true });
  await cdp.navigate(`${server.url}/`);
  await cdp.wait(locked);
  await reveal(cdp);
  server.fixtureDevice({ banned: true });
  await pin(cdp, "112233");
  await cdp.wait(`${text}.indexOf('设备或账户已被封禁')>=0`);
  await captures(cdp, name, "light", "banned");
  server.fixtureDevice({ banned: false, clearThrottle: true });
  await click(cdp, "重新尝试");
  await pin(cdp, "112233");
  await cdp.wait(app);
  cases += 2;
  await connected(cdp);
  await click(cdp, "设置");
  server.revokeSessions();
  await click(cdp, "编辑资料");
  await fill(cdp, "显示名称", "失效会话不能保存");
  await click(cdp, "保存个人资料");
  await cdp.wait("!!document.querySelector('[data-testid=\"auth.login\"]')");
  assert.notEqual(server.readUser("new_member").name, "失效会话不能保存");
  await cdp.offline(true);
  await pin(cdp, "112233");
  await cdp.wait(`${text}.indexOf('尚未在本机登录')>=0`);
  await cdp.offline(false);
  await connected(cdp);
  await pin(cdp, "112233");
  await cdp.wait(app);
  cases++;
  await click(cdp, "设置");
  await click(cdp, "编辑资料");
  await fill(cdp, "显示名称", "封禁设备不能保存");
  // Ban only now: the reconnect sync may still be in flight and would lock the
  // device before the form opens.
  server.fixtureDevice({ banned: true });
  await click(cdp, "保存个人资料");
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"auth.device-locked\"]')",
  );
  await click(cdp, "退出登录");
  await click(cdp, "确认退出登录");
  await cdp.wait(
    '!!document.querySelector(\'[data-testid="auth.login"], [data-testid="auth.concealed"]\')',
  );
  assert.equal(
    server.sessionCount(),
    0,
    "denied-screen logout revokes server session",
  );
  server.fixtureDevice({ banned: false });
  await pin(cdp, "112233");
  await cdp.wait(app);
  await connected(cdp);
  cases++;
  const shellBefore = await cdp.evaluate(
    "window.__talosShell.status().then(function(s){return s.active;})",
  );
  await cdp.offline(true);
  await cdp.wait(`${text}.indexOf('离线')>=0`);
  await click(cdp, "设置");
  await cdp.evaluate(
    "document.querySelector('[role=switch][aria-label=免打扰]').click()",
  );
  await cdp.wait(`${text}.indexOf('待同步')>=0`);
  await click(cdp, "重置本机数据");
  await cdp.wait(`${text}.indexOf('1 项尚未同步')>=0`);
  await captures(cdp, name, "dark", "reset-warning");
  await click(cdp, "确认重置本机数据");
  await eventually(
    () =>
      cdp
        .evaluate(
          "!!document.querySelector('[data-testid=\"auth.concealed\"]')",
        )
        .catch((error) => {
          if (/Execution context|Cannot find context/.test(error.message))
            return false;
          throw error;
        }),
    (value) => value === true,
    "reset reload reaches concealed gate",
  );
  await reveal(cdp);
  await cdp.wait("!!document.querySelector('[data-testid=\"auth.login\"]')");
  await cdp.wait("!!window.__talosShell");
  const shellAfter = await cdp.evaluate(
    "window.__talosShell.status().then(function(s){return s.active;})",
  );
  assert.equal(
    shellAfter,
    shellBefore,
    "reset preserves installed shell offline",
  );
  await pin(cdp, "112233");
  await cdp.wait(`${text}.indexOf('尚未在本机登录')>=0`);
  await cdp.offline(false);
  cases++;
  return cases;
}
