import type { ReactElement, ReactNode } from "react";
import "./auth.css";
import { Icon } from "../../../ui/icon/index.ts";
import { StatusPill } from "../../../ui/feedback/index.ts";
import type { StatusViewModel } from "../../../core/status/model.ts";
import { ClientBadge } from "./client-badge.tsx";
export function AuthScreenView({
  locked,
  heading,
  intro,
  device,
  status,
  onStatus,
  children,
}: {
  locked: boolean;
  heading: string;
  intro: string;
  device?: string;
  status: StatusViewModel;
  onStatus?: () => void;
  /** The PIN entry. */
  children: ReactNode;
}): ReactElement {
  return (
    <main
      className="auth-page"
      data-testid={locked ? "auth.lock" : "auth.login"}
    >
      <header className="auth-top">
        <span className="auth-brand">Talos II</span>
        <StatusPill model={status} onClick={onStatus} />
      </header>
      <section className="auth-card">
        <div className="auth-symbol">
          <Icon name={locked ? "lock" : "key"} size={24} />
        </div>
        <h1>{heading}</h1>
        <p className="auth-intro">{intro}</p>
        {children}
      </section>
      <footer className="auth-bottom">
        <ClientBadge device={device} />
      </footer>
    </main>
  );
}
