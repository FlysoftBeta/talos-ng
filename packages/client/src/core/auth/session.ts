import type { ResultOf } from "@talos/contract";
import type { contract } from "@talos/contract";
import type { PinVerifier } from "./pin.ts";
export type Gate =
  "boot" | "deviceLocked" | "signedOut" | "onboarding" | "appLocked" | "app";
export type SavedSession = ResultOf<typeof contract.auth.resume> & {
  verifier?: PinVerifier;
  verifiers?: PinVerifier[];
  failures?: number;
  blockedUntil?: number;
};
export type GateEvent =
  | "admitted"
  | "denied"
  | "restore"
  | "login"
  | "lock"
  | "unlock"
  | "signOut"
  | "onboard";
/** Network authentication does not imply that concealed content may be revealed. */
export function sessionGate(gate: Gate, event: GateEvent): Gate {
  if (event === "denied") return "deviceLocked";
  if (event === "signOut") return "signedOut";
  if (event === "lock") return gate === "app" ? "appLocked" : gate;
  if (gate === "boot" && event === "restore") return "appLocked";
  if ((gate === "boot" || gate === "deviceLocked") && event === "admitted")
    return "signedOut";
  if (gate === "signedOut" && event === "onboard") return "onboarding";
  if ((gate === "signedOut" || gate === "onboarding") && event === "login")
    return "app";
  if (gate === "appLocked" && (event === "unlock" || event === "login"))
    return "app";
  return gate;
}
