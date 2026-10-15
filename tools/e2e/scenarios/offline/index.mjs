import { smokeSuite } from "./smoke.mjs";
import { updateSuite } from "./update.mjs";

/** Gallery, ServiceWorker offline reload, corrupt-asset rejection, verified update and rollback. */
export default {
  name: "offline",
  server: "static",
  async run({ adapter, legacy }, server) {
    await smokeSuite(adapter, server, { legacy });
    await updateSuite(adapter, server);
  },
};
