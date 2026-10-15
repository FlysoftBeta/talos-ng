import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
/** Git-ignored output directory: screenshots and measurements are debugging artifacts only. */
export const OUTPUT =
  process.env.TALOS_E2E_OUTPUT_DIR ?? path.join(root, ".tmp/e2e");
export const SCREENSHOTS = path.join(OUTPUT, "screenshots");
