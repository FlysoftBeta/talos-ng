import { realSuite } from "./session.mjs";

/** Session, settings, offline outbox, rejection, update and onboarding/admission on one real server. */
export default {
  name: "identity",
  server: "real",
  async run({ adapter, legacy }, server) {
    await realSuite(adapter, server, { legacy });
  },
};
