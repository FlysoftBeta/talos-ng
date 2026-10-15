import type { Database } from "@talos/store";
import type { SavedSession } from "../auth/session.ts";
import type { ClientSnapshot } from "../lifecycle/snapshot.ts";
import type { NavGuards } from "./guards.ts";
import type { Nav, NavIntent } from "./index.ts";
import { navReducer } from "./index.ts";

export interface NavigationControllerPorts {
  lock(reason?: "manual" | "idle"): void;
  navigationGuards: NavGuards;
  snapshot: ClientSnapshot;
  publish(patch: Partial<ClientSnapshot>): void;
  saved?: SavedSession;
  db?: Database;
  report: (error: unknown) => void;
}

export class NavigationController {
  constructor(private readonly ports: NavigationControllerPorts) {}
  dispatch(intent: NavIntent): void {
    if (intent.type === "lock") {
      this.ports.lock();
      return;
    }
    this.ports.navigationGuards.request(intent, () =>
      this.commitNavigation(intent),
    );
  }
  commitNavigation(intent: NavIntent): void {
    const nav = navReducer(this.ports.snapshot.nav, intent);
    this.ports.publish({ nav });
    if (this.ports.saved)
      void this.ports
        .db!.table<Nav, string>("nav")
        .put(nav, this.ports.saved.user.id)
        .catch(this.ports.report);
  }
}
