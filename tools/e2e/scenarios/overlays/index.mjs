import assert from "node:assert/strict";
import path from "node:path";
import { SCREENSHOTS } from "../../harness/artifacts.mjs";

const select = 'button[aria-haspopup="listbox"]';
const list = '[role="listbox"]';
const menu = '[role="menu"]';
const clip = '[data-testid="dev.overlay.clip"]';
const next = '[data-testid="dev.overlay.next"]';
const icon = 'button[aria-label="被裁切的图标说明"]';
const menuTrigger = 'button[aria-haspopup="menu"]';
const q = (selector) => `document.querySelector(${JSON.stringify(selector)})`;
const frames =
  "new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});})";

export default {
  name: "overlays",
  server: "static",
  async run({ adapter, legacy }, server) {
    const cdp = adapter.cdp;
    const click = async (selector) => {
      const point = await cdp.evaluate(
        `(function(){var r=${q(selector)}.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`,
      );
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        button: "left",
        clickCount: 1,
        ...point,
      });
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        button: "left",
        clickCount: 1,
        ...point,
      });
      await cdp.evaluate(frames);
    };
    const key = async (key, modifiers = 0) => {
      const code = {
        Tab: 9,
        Enter: 13,
        Escape: 27,
        Home: 36,
        End: 35,
        ArrowDown: 40,
        ArrowUp: 38,
      }[key];
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        ...(key === "Enter" ? { text: "\r" } : {}),
        key,
        windowsVirtualKeyCode: code,
        modifiers,
      });
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        windowsVirtualKeyCode: code,
        modifiers,
      });
      await cdp.evaluate(frames);
    };
    const opened = async (selector) =>
      cdp.wait(
        `${q(selector)} && getComputedStyle(${q(selector)}).visibility === 'visible'`,
      );
    const visible = async (selector) => {
      await opened(selector);
      const result = await cdp.evaluate(
        `(function(){var e=${q(selector)},r=e.getBoundingClientRect();return {bounds:r.left>=7&&r.top>=7&&r.right<=innerWidth-7&&r.bottom<=innerHeight-7,hit:[r.top+6,r.bottom-6].every(function(y){return e.contains(document.elementFromPoint(r.left+12,y));}),height:r.height};})()`,
      );
      assert.ok(
        result.bounds && result.hit && result.height > 20,
        `${selector} is unclipped, on top, within viewport: ${JSON.stringify(result)}`,
      );
    };
    // Exercise the fallback explicitly in both engines, including current Chromium.
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "window.ResizeObserver=undefined",
    });
    for (const [width, height, dark] of [
      [1280, 800, false],
      [768, 1024, true],
      [320, 480, false],
    ]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await cdp.navigate(
        `${server.url}/gallery.html?overlays${dark ? "&theme=dark" : ""}`,
      );
      await cdp.wait(q(select));
      for (const mode of ["page", "dialog", "sheet"]) {
        console.log(`[overlays] ${width}x${height} ${mode}`);
        if (mode !== "page") {
          await cdp.evaluate(
            `Array.from(document.querySelectorAll('button')).find(function(b){return b.textContent==='${mode === "dialog" ? "打开对话框" : "打开侧栏"}';}).click()`,
          );
          await cdp.wait(
            "document.querySelectorAll('[role=dialog]').length===1",
          );
        }
        await click(select);
        await visible(list);
        await cdp.screenshot(
          path.join(
            SCREENSHOTS,
            `${legacy ? "chrome70" : "current"}-overlay-${mode}-${width}-select.png`,
          ),
        );
        assert.equal(
          await cdp.evaluate(`${q(list)}.contains(document.activeElement)`),
          true,
          "listbox owns focus inside modal trap",
        );
        assert.equal(
          await cdp.evaluate(`${q(clip)}.contains(${q(list)})`),
          false,
          "listbox escapes transformed scroller",
        );
        await key("Home");
        await key("ArrowDown");
        assert.equal(
          await cdp.evaluate(
            "document.activeElement.getAttribute('data-value')",
          ),
          "2",
          "keyboard skips disabled option",
        );
        await key("Enter");
        await cdp.wait(`!${q(list)}`);
        assert.equal(
          await cdp.evaluate(
            `${q('[data-testid="dev.overlay.value"]')}.textContent`,
          ),
          "2",
        );
        assert.equal(
          await cdp.evaluate(`document.activeElement===${q(select)}`),
          true,
          "selection restores trigger focus",
        );
        await click(select);
        await key("End");
        assert.equal(
          await cdp.evaluate(
            "document.activeElement.getAttribute('data-value')",
          ),
          "29",
        );
        assert.ok(
          await cdp.evaluate(`${q(list)}.scrollTop > 0`),
          "keyboard scrolls long options into view",
        );
        await key("Escape");
        assert.equal(
          await cdp.evaluate(
            "document.querySelectorAll('[role=dialog]').length",
          ),
          mode === "page" ? 0 : 1,
          "Escape only dismisses picker",
        );
        await click(select);
        await key("Tab");
        assert.equal(
          await cdp.evaluate(
            `document.activeElement.getAttribute('aria-label')`,
          ),
          "图标说明",
          "Tab continues in form order",
        );
        await click(select);
        await key("Tab", 8);
        assert.equal(
          await cdp.evaluate(`!!${q(list)}`),
          false,
          "Shift+Tab dismisses picker",
        );
        await click(select);
        await click(next);
        assert.equal(
          await cdp.evaluate(`!!${q(list)}`),
          false,
          "outside pointer dismisses picker",
        );
        assert.equal(
          await cdp.evaluate(`document.activeElement===${q(next)}`),
          true,
          "outside click keeps its destination focus",
        );
        await click(select);
        const before = await cdp.evaluate(
          `${q(select)}.getBoundingClientRect().bottom`,
        );
        await cdp.evaluate(`${q(clip)}.scrollTop+=16`);
        await cdp.evaluate(frames);
        assert.equal(
          await cdp.evaluate(`${q(select)}.getBoundingClientRect().bottom`),
          before - 16,
        );
        await visible(list);
        assert.equal(
          await cdp.evaluate(
            `(function(){var a=${q(select)}.getBoundingClientRect(),p=${q(list)}.getBoundingClientRect();return Math.min(Math.abs(p.top-a.bottom-4),Math.abs(a.top-p.bottom-4))<2;})()`,
          ),
          true,
          "scroll keeps the popup attached to its anchor",
        );
        await cdp.evaluate(`${q(clip)}.scrollTop=240`);
        await cdp.wait(`!${q(list)}`);
        assert.equal(
          await cdp.evaluate(`document.activeElement===${q(select)}`),
          true,
          "scroll dismissal preserves keyboard focus without scrolling back",
        );
        assert.ok(await cdp.evaluate(`${q(clip)}.scrollTop>=240`));
        await cdp.evaluate(`${q(clip)}.scrollTop=0`);
        await cdp.evaluate(frames);
        // Tooltip escapes an overflow:hidden transformed toolbar, with theme inherited.
        const point = await cdp.evaluate(
          `(function(){var r=${q(icon)}.getBoundingClientRect();return {x:r.left+20,y:r.top+20};})()`,
        );
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...point,
        });
        await opened('[role="tooltip"]');
        assert.equal(
          await cdp.evaluate(
            `(function(){var e=document.querySelector('[role=tooltip]'),r=e.getBoundingClientRect(),p=${q('[data-testid="dev.overlay.tools"]')}.getBoundingClientRect();return r.bottom>p.bottom&&r.left>=8&&r.right<=innerWidth-8;})()`,
          ),
          true,
          "tooltip extends beyond clipping toolbar within viewport",
        );
        await cdp.screenshot(
          path.join(
            SCREENSHOTS,
            `${legacy ? "chrome70" : "current"}-overlay-${mode}-${width}-tooltip.png`,
          ),
        );
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: 0,
          y: 0,
        });
        await click('button[aria-label="详细说明"]');
        await visible('[role="tooltip"]');
        await key("Escape");
        await click(menuTrigger);
        await visible(menu);
        await key("End");
        await key("Home");
        await cdp.screenshot(
          path.join(
            SCREENSHOTS,
            `${legacy ? "chrome70" : "current"}-overlay-${mode}-${width}-menu.png`,
          ),
        );
        await key("Enter");
        await cdp.wait(
          `document.querySelectorAll('[role=dialog]').length===${mode === "page" ? 1 : 2}`,
        );
        assert.equal(
          await cdp.evaluate(
            "Array.from(document.querySelectorAll('[role=dialog]')).pop().contains(document.activeElement)",
          ),
          true,
          "child dialog takes focus",
        );
        await key("Escape");
        await cdp.wait(
          `document.querySelectorAll('[role=dialog]').length===${mode === "page" ? 0 : 1}`,
        );
        assert.equal(
          await cdp.evaluate(`document.activeElement===${q(menuTrigger)}`),
          true,
          "child restores menu trigger",
        );
        // Resize an open list, then verify it repositions without ResizeObserver.
        await click(select);
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: height - 80,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await cdp.evaluate(frames);
        await visible(list);
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await key("Escape");
        if (mode !== "page") {
          await click('button[aria-label="页脚操作"]');
          await key("Tab");
          assert.equal(
            await cdp.evaluate(
              "document.activeElement.getAttribute('aria-label')",
            ),
            "关闭",
            "Tab from the last popup trigger wraps inside the modal",
          );
          await key("Escape");
          await cdp.wait("!document.querySelector('[role=dialog]')");
        }
      }
      // Left/top viewport edge: end-aligned wide menu must not run off-screen.
      await cdp.evaluate(
        `${q('[data-testid="dev.overlay.page"]')}.style.cssText='position:absolute;left:0;top:0;width:180px'`,
      );
      await click(menuTrigger);
      await visible(menu);
      await key("Escape");
    }
    assert.deepEqual(adapter.errors, [], "no browser errors");
  },
};
