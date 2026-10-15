import { adminSuite } from "./suite.mjs";
import { seedAdminUsers } from "./seed.mjs";

export default {
  name: "admin",
  server: "real",
  prepare: (server) => seedAdminUsers(server),
  run: ({ adapter, legacy }, server) => adminSuite(adapter, server, { legacy }),
};
