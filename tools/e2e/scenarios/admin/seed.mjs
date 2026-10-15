import { DatabaseSync } from "node:sqlite";
import path from "node:path";

/** Large fixture for the real server's paged workbench query. */
export function seedAdminUsers(server, count = 2_000) {
  const db = new DatabaseSync(path.join(server.data, "talos.db"));
  try {
    const insert = db.prepare(
      "INSERT INTO users(id,handle,name,roles,features,created,rev,credential_version) VALUES(?,?,?,?,?,?,?,?)",
    );
    db.exec("BEGIN");
    for (let index = 0; index < count; index++) {
      const suffix = String(index).padStart(8, "0");
      insert.run(
        `01ADMN000000000000${suffix}`,
        `fixture${suffix}`,
        `测试成员 ${suffix}`,
        "[]",
        "[]",
        1_700_000_000_000 + index,
        1,
        1,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.isOpen) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
