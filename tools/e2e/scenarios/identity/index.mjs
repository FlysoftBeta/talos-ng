import { realSuite } from "./session.mjs";
import { disciplineScenarios } from "../learning/discipline.mjs";

/** Session, settings, offline outbox, rejection, update, onboarding/admission and learning on one real server. */
export default {
  name: "identity",
  server: "real",
  async run({ adapter, legacy }, server) {
    await realSuite(adapter, server, { legacy });
    await disciplineScenarios(
      adapter.cdp,
      server,
      legacy ? "chrome70" : "current",
    );
  },
};
