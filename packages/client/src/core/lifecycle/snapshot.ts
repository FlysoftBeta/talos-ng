import type { User } from "@talos/contract";
import type { Admission } from "../auth/admission.ts";
import type { Gate } from "../auth/session.ts";
import type { Nav } from "../navigation/index.ts";
import type { StatusViewModel } from "../status/model.ts";
export type Capability = { ok: true } | { ok: false; reason: string };
export interface ClientSnapshot {
  gate: Gate;
  concealed: boolean;
  device?: string;
  admission?: Admission;
  lockReason?: "manual" | "idle";
  logoutName?: string;
  user?: User;
  nav: Nav;
  status: StatusViewModel;
  error?: string;
  busy: boolean;
}
