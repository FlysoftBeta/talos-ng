import { diagnosticError, diagnosticText } from "@talos/base";
import type { ArgsOf, contract } from "@talos/contract";
export type ClientIncident = ArgsOf<typeof contract.admin.incident.report>;
export interface DiagnosticStore {
  user(): string | undefined;
  read(user: string): Promise<ClientIncident[]>;
  write(user: string, rows: ClientIncident[]): Promise<void>;
  send(row: ClientIncident): Promise<unknown>;
  online(): boolean;
}
/** Bounded before serialization as well as on disk; failures never report recursively. */
export class BrowserDiagnostics {
  private serial = Promise.resolve();
  private pending = 0;
  constructor(
    private readonly store: DiagnosticStore,
    private readonly build: string,
    private readonly environment: () => string,
  ) {}
  capture(error: unknown, kind: ClientIncident["kind"]): void {
    const user = this.store.user();
    if (!user || this.pending >= 20) return;
    const row: ClientIncident = {
      ...diagnosticError(error),
      kind,
      build: this.build.slice(0, 128),
      environment: diagnosticText(this.environment(), 512),
    };
    this.pending++;
    this.serial = this.serial
      .then(async () => {
        if (this.store.user() !== user) return;
        const rows = await this.store.read(user);
        await this.store.write(user, [...rows.slice(-19), row]);
      })
      .catch(() => {})
      .then(() => {
        this.pending--;
      });
    void this.flush();
  }
  flush(): Promise<void> {
    // At most one flush is queued per accepted capture, not per rejected event.
    this.serial = this.serial
      .then(async () => {
        const user = this.store.user();
        if (!user || !this.store.online()) return;
        const rows = await this.store.read(user);
        while (
          rows.length &&
          this.store.user() === user &&
          this.store.online()
        ) {
          await this.store.send(rows[0]!);
          rows.shift();
          await this.store.write(user, rows);
        }
      })
      .catch(() => {});
    return this.serial;
  }
}
