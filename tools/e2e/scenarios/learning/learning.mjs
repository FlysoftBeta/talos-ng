import assert from "node:assert/strict";
import { eventually } from "../../harness/wait.mjs";
import {
  text,
  app,
  locked,
  click,
  pin,
  select,
  captures,
  connected,
} from "../../harness/ui.mjs";

export async function learningScenarios(cdp, server, name) {
  await click(cdp, "学习");
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"learning.stats\"]') && document.body.textContent.indexOf('16 词已缓存')>=0",
  );
  await captures(cdp, name, "light", "learning-dashboard");
  await click(cdp, "开始练习");
  await cdp.wait("!!document.querySelector('[data-testid=\"learning.word\"]')");
  await captures(cdp, name, "light", "learning-practice");
  await cdp.offline(true);
  await cdp.wait(`${text}.indexOf('离线')>=0`);
  for (let n = 1; n <= 10; n++) {
    await cdp.evaluate(
      `(function(){var word=document.querySelector('[data-testid=\"learning.word\"]').textContent;var choice=Array.prototype.slice.call(document.querySelectorAll('[data-testid=\"learning.choice\"]')).find(function(button){return button.textContent.indexOf('释义'+word.slice(4))>=0;});if(!choice)throw new Error('Missing answer for '+word);choice.click();})()`,
    );
    await cdp.wait(`${text}.indexOf('已答 ${n} ·')>=0`);
    if (n < 10)
      await cdp.wait(
        "!!document.querySelector('[data-testid=\"learning.choice\"]:not(:disabled)')",
      );
  }
  await click(cdp, "结束练习");
  await cdp.wait(`${text}.indexOf('本次练习总结')>=0`);
  await captures(cdp, name, "light", "learning-summary");
  await click(cdp, "结束并离开");
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"learning.stats\"]')",
  );
  assert.equal(await cdp.evaluate(`${text}.indexOf('待同步')>=0`), true);
  await cdp.navigate(`${server.url}/`);
  await cdp.wait(locked);
  await pin(cdp, "654321", "解锁");
  await cdp.wait(app);
  await click(cdp, "学习");
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"learning.stats\"]')",
  );
  assert.equal(
    await cdp.evaluate(
      `${text}.indexOf('累计作答')>=0 && ${text}.indexOf('10 次')>=0`,
    ),
    true,
    "offline restart retains progress",
  );
  await cdp.offline(false);
  await connected(cdp);
  await eventually(
    () => server.learningAnswers("demo"),
    (n) => n === 10,
    "offline answers converged on server",
  );
  await select(cdp, "练习节奏", "极速");
  await click(cdp, "开始练习");
  await cdp.wait("!!document.querySelector('[data-testid=\"learning.word\"]')");
  await captures(cdp, name, "light", "learning-speed");
  await cdp.wait(`${text}.indexOf('已答 1 ·')>=0`);
  await click(cdp, "结束练习");
  await click(cdp, "结束并离开");
  await click(cdp, "复习错题");
  await cdp.wait(`${text}.indexOf('错题本 ·')>=0`);
  await captures(cdp, name, "light", "learning-wrong");
  await click(cdp, "开始清错");
  await cdp.wait("!!document.querySelector('[data-testid=\"learning.word\"]')");
  await captures(cdp, name, "light", "learning-clear");
  await click(cdp, "AI");
  await cdp.wait(`${text}.indexOf('本次练习总结')>=0`);
  assert.equal(
    await cdp.evaluate(
      "!!document.querySelector('[data-testid=\"learning.word\"]')",
    ),
    true,
    "navigation stayed guarded",
  );
  await click(cdp, "结束并离开");
  await cdp.wait(
    "!!document.querySelector('button[aria-label=AI][aria-current]')",
  );
  await click(cdp, "学习");
  await click(cdp, "已掌握");
  // Ten sampled answers need not repeat a word enough to master it. The
  // redesigned empty list has a plain heading; populated lists add a count.
  await cdp.wait(
    "Array.prototype.some.call(document.querySelectorAll('[data-testid=\"learning.page\"] .pane-header h2'), function(h){return /^已掌握(?: · [0-9]+ 词)?$/.test(h.textContent);})",
  );
  await captures(cdp, name, "light", "learning-mastered");
  return 7;
}
