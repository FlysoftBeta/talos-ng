import type { ReactElement, ReactNode } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { Field } from "../../../ui/inputs/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import { InlineNotice } from "../../../ui/feedback/index.ts";
import "./auth.css";
import { ClientBadge } from "./client-badge.tsx";
export type OnboardingViewStep = "pin" | "choice" | "profile";
export function OnboardingView({
  step,
  prompt,
  pinEntry,
  device,
  profile,
  onAddSecond,
  onSingle,
}: {
  step: OnboardingViewStep;
  /** Instruction above the PIN entry. */
  prompt: string;
  pinEntry: ReactNode;
  device?: string;
  profile: {
    handle: string;
    name: string;
    busy: boolean;
    error?: string;
    offline: boolean;
    canSubmit: boolean;
    onHandle: (value: string) => void;
    onName: (value: string) => void;
    onSubmit: () => void;
    onRestart: () => void;
  };
  onAddSecond: () => void;
  onSingle: () => void;
}): ReactElement {
  return (
    <main className="auth-page" data-testid="auth.onboarding">
      <header className="auth-top">
        <span className="auth-brand">Talos II</span>
      </header>
      <section className="auth-card">
        <div className="auth-symbol">
          <Icon name={step === "profile" ? "user" : "key"} size={24} />
        </div>
        <h1>完成账号设置</h1>
        {step === "pin" ? (
          <>
            <p className="auth-intro">{prompt}</p>
            {pinEntry}
          </>
        ) : step === "choice" ? (
          <>
            <p className="auth-intro">
              第二个 PIN 是备用登录凭据，两个 PIN 都能进入同一账号。
            </p>
            <div className="auth-actions">
              <Button variant="primary" block onClick={onSingle}>
                只使用一个 PIN
              </Button>
              <Button variant="secondary" block onClick={onAddSecond}>
                添加第二个 PIN
              </Button>
            </div>
          </>
        ) : (
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              profile.onSubmit();
            }}
          >
            <Field
              label="账号标识"
              name="handle"
              value={profile.handle}
              maxLength={20}
              autoComplete="off"
              hint="1–20 位字母、数字或下划线"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (profile.handle)
                    event.currentTarget.form
                      ?.querySelector<HTMLInputElement>(
                        'input[name="displayName"]',
                      )
                      ?.focus();
                }
              }}
              disabled={profile.busy}
              onChange={(event) => profile.onHandle(event.target.value)}
            />
            <Field
              label="显示名称"
              name="displayName"
              value={profile.name}
              maxLength={30}
              disabled={profile.busy}
              onChange={(event) => profile.onName(event.target.value)}
            />
            {profile.error && (
              <InlineNotice tone="failed">{profile.error}</InlineNotice>
            )}
            {profile.offline && (
              <InlineNotice tone="pending">创建账号需要连接服务器</InlineNotice>
            )}
            <div className="auth-actions">
              <Button
                type="submit"
                variant="primary"
                block
                busy={profile.busy}
                disabled={!profile.canSubmit}
              >
                完成并进入
              </Button>
              <Button
                variant="ghost"
                block
                disabled={profile.busy}
                onClick={profile.onRestart}
              >
                重新设置 PIN
              </Button>
            </div>
          </form>
        )}
      </section>
      <footer className="auth-bottom">
        <ClientBadge device={device} />
      </footer>
    </main>
  );
}
