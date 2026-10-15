import { click } from "../../harness/ui.mjs";

const nav = "nav[aria-label=管理栏目]";

/**
 * Opens a workbench section and returns once the workbench has registered the selection
 * (the section's nav entry is `aria-current=page`), never merely once a click was dispatched.
 * A click is repeated only when that registration did not appear, i.e. it provably did not take effect;
 * content readiness is then the caller's own wait on the section's real output.
 */
export async function openSection(cdp, title) {
  const selected = `Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(`${nav} button[aria-current=page]`)})).some(function(b){return b.textContent.trim()===${JSON.stringify(title)}})`;
  for (let attempt = 1; ; attempt++) {
    await cdp.wait(
      `Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(`${nav} button`)})).some(function(b){return b.textContent.trim()===${JSON.stringify(title)}})`,
    );
    await click(cdp, title);
    try {
      await cdp.wait(selected, 5_000);
      return;
    } catch (error) {
      if (attempt >= 3)
        throw new Error(`Workbench section "${title}" was not selected`, {
          cause: error,
        });
    }
  }
}

/** Waits for the paged users grid to report the whole seeded population; a failed load is reported with the pane text. */
export async function usersGridLoaded(cdp, rows) {
  try {
    await cdp.wait(
      `!!document.querySelector('[data-testid=\"admin.users\"] [role=table][aria-rowcount="${rows}"]')`,
    );
  } catch (error) {
    const pane = await cdp
      .evaluate(
        "(document.querySelector('[data-testid=\"admin.users\"]')||document.body).textContent.slice(0,300)",
      )
      .catch(() => "page unavailable");
    throw new Error(
      `Users grid did not load ${rows} rows; pane shows: ${pane}`,
      {
        cause: error,
      },
    );
  }
}
