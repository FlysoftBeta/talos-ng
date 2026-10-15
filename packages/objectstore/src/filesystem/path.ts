import { join } from "node:path";
import { validateId } from "../content/identity.ts";

export function objectPath(root: string, id: string): string {
  validateId(id);
  return join(root, "objects", id.slice(0, 2), id.slice(2, 4), id);
}
