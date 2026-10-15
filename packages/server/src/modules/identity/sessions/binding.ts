import type { Connection } from "@talos/link";
import type { SessionBinding } from "../ports.ts";
export function sessionState(
  connection: Connection,
): SessionBinding | undefined {
  return connection.ctx.get("session") as SessionBinding | undefined;
}
