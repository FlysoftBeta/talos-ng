import type { Db } from "../../kernel/persistence/db.ts";
export function adminMaintenance(db: Db): (now: number) => void {
  return (now) => {
    db.run("DELETE FROM admin_downloads WHERE expires<=?", now);
  };
}
