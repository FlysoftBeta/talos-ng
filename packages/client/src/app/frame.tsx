import "./app.css";
import { AiList, AiContent } from "../features/ai/index.ts";
import { TasksSheet } from "../features/tasks/index.ts";
import {
  LearningProvider,
  LearningScreen,
  LearningSidebar,
  LearningOverlays,
} from "../features/learning/index.ts";
import { LibraryBackground } from "../features/library/index.ts";
import {
  LibraryAreaContent,
  LibraryAreaList,
  adminExtensions,
} from "./areas.tsx";
import {
  MediaList,
  MediaContent,
  MediaBackground,
  MediaMiniPlayer,
  MediaPlayerProvider,
} from "../features/media/index.ts";
import { useAdminWorkbench } from "../features/admin/index.tsx";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import {
  useRuntime,
  useClientSnapshot,
  useGate,
} from "../platform/react/context.tsx";
import { AREA_IDS } from "../core/navigation/index.ts";
import type { AreaId, Page } from "../core/navigation/index.ts";
import {
  AuthScreen,
  DeviceLockedScreen,
  ConcealedScreen,
  OnboardingScreen,
} from "../features/auth/index.ts";
import {
  ChatList,
  ChatContent,
  ChatBackground,
  useChatUnread,
} from "../features/chat/connect/index.tsx";
import { SettingsSheet } from "../features/settings/index.ts";
import { AppFrame, EmptyPane, Pane, PaneHeader } from "../ui/layout/index.ts";
import { Icon } from "../ui/icon/index.ts";
import type { IconName } from "../ui/icon/index.ts";
import { Rail, RailItem, RailSpacer } from "../ui/navigation/index.ts";
import { StatePanel, StatusCenter, StatusPill } from "../ui/feedback/index.ts";
import { TalosProvider } from "../ui/theme/index.ts";
import type { ColorMode } from "../ui/theme/index.ts";
const areas: Record<
  AreaId,
  { title: string; icon: IconName; hint: string; list: "collection" | "nav" }
> = {
  chat: {
    title: "对话",
    icon: "chat",
    hint: "选择一个对话",
    list: "collection",
  },
  library: {
    title: "阅读",
    icon: "library",
    hint: "选择一份文档",
    list: "collection",
  },
  learning: { title: "学习", icon: "learning", hint: "", list: "nav" },
  media: { title: "音乐", icon: "media", hint: "", list: "nav" },
  ai: { title: "AI", icon: "ai", hint: "开始一段新对话", list: "collection" },
};
const PRACTICE = /^learning\.(normal|speed|clear|discipline)$/;
/** Immersive pages hide the list pane: an open document, a practice round. */
function isFocus(area: AreaId, top: Page | undefined): boolean {
  if (!top) return false;
  if (area === "library") return top.kind === "document";
  if (area === "learning") return top.kind === "page" && PRACTICE.test(top.id);
  return false;
}
function useSystemMode(): ColorMode {
  const [mode, setMode] = useState<ColorMode>(() =>
    typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setMode(query.matches ? "dark" : "light");
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);
  return mode;
}
export function App(): ReactElement {
  return (
    <LearningProvider>
      <MediaPlayerProvider>
        <AppContent />
      </MediaPlayerProvider>
    </LearningProvider>
  );
}
function AppContent(): ReactElement {
  const runtime = useRuntime();
  const state = useClientSnapshot();
  useEffect(() => runtime.stableGate(), [runtime, state.gate]);
  const systemMode = useSystemMode();
  const admin = useGate("admin");
  const offline = useGate("offline");
  const areaGates = {
    chat: { ok: true as const },
    library: useGate("articles"),
    learning: useGate("learning"),
    media: useGate("media"),
    ai: useGate("ai"),
  };
  const areaGate = areaGates[state.nav.area];
  const chatUnread = useChatUnread();
  const preferred = runtime.setting<string>("theme", "system");
  const mode =
    preferred === "dark" || preferred === "light" ? preferred : systemMode;
  const [gateStatus, setGateStatus] = useState(false);
  const current = areas[state.nav.area];
  const stack = state.nav.areas[state.nav.area].stack;
  const top = stack[stack.length - 1];
  const overlay = state.nav.overlays[state.nav.overlays.length - 1];
  const adminOpen = overlay?.kind === "admin" && admin.ok;
  const workbench = useAdminWorkbench(adminExtensions);
  const close = () => runtime.dispatch({ type: "closeOverlay" });
  const open = (kind: "settings" | "status" | "tasks" | "admin") =>
    runtime.dispatch({ type: "openOverlay", overlay: { kind } });
  const isApp = state.gate === "app";
  return (
    <TalosProvider
      mode={mode}
      className={
        runtime.setting<string>("textSize", "normal") === "large"
          ? "text-large"
          : ""
      }
    >
      <>
        {state.gate === "boot" ? (
          <main className="boot-page">
            <StatePanel state="loading" title="正在打开" hint="" />
          </main>
        ) : state.concealed ||
          (state.gate === "app" &&
            (state.status.connection === "offline" ||
              state.status.connection === "connecting") &&
            !offline.ok) ? (
          <ConcealedScreen onReveal={() => runtime.reveal()} />
        ) : state.gate === "deviceLocked" ? (
          <DeviceLockedScreen
            admission={state.admission}
            device={state.device}
            onRetry={() => runtime.retryAdmission()}
            logout={
              state.logoutName
                ? {
                    name: state.logoutName,
                    reason:
                      state.status.connection === "offline"
                        ? "此操作需要连接服务器"
                        : undefined,
                    run: () => runtime.logout(),
                  }
                : undefined
            }
          />
        ) : state.gate === "onboarding" ? (
          <OnboardingScreen />
        ) : !isApp ? (
          <AuthScreen
            key={state.gate}
            locked={state.gate === "appLocked"}
            name={state.user?.name}
            device={state.device}
            lockReason={state.lockReason}
            error={state.error}
            busy={state.busy}
            status={state.status}
            onLogin={(pin) => {
              void runtime.login(pin);
            }}
            onStatus={() => setGateStatus(true)}
          />
        ) : (
          <div className="app-root" data-testid="app.ready">
            <AppFrame
              listKind={adminOpen ? "nav" : areas[state.nav.area].list}
              focus={!adminOpen && isFocus(state.nav.area, top)}
              detail={adminOpen || stack.length > 1}
              onBack={() =>
                adminOpen ? close() : runtime.dispatch({ type: "back" })
              }
              rail={
                <Rail>
                  {AREA_IDS.filter((area) => areaGates[area].ok).map((area) => (
                    <RailItem
                      key={area}
                      label={areas[area].title}
                      icon={<Icon name={areas[area].icon} size={22} />}
                      selected={!adminOpen && state.nav.area === area}
                      badge={area === "chat" ? chatUnread : undefined}
                      onClick={() => {
                        if (adminOpen) close();
                        runtime.dispatch({ type: "switchArea", area });
                      }}
                    />
                  ))}
                  <RailSpacer />
                  <MediaMiniPlayer />
                  <StatusPill
                    rail
                    model={state.status}
                    onClick={() => open("status")}
                  />
                  <RailItem
                    label="任务"
                    icon={<Icon name="tasks" size={22} />}
                    onClick={() => open("tasks")}
                  />
                  <RailItem
                    label="设置"
                    icon={<Icon name="settings" size={22} />}
                    onClick={() => open("settings")}
                  />
                  {admin.ok && (
                    <RailItem
                      label="管理"
                      icon={<Icon name="admin" size={22} />}
                      selected={adminOpen}
                      onClick={() => (adminOpen ? close() : open("admin"))}
                    />
                  )}
                  <RailItem
                    label="锁定"
                    icon={<Icon name="lock" size={22} />}
                    onClick={() => runtime.lock()}
                  />
                </Rail>
              }
              list={
                adminOpen ? (
                  workbench.list
                ) : state.nav.area === "ai" ? (
                  <AiList />
                ) : state.nav.area === "chat" ? (
                  <ChatList />
                ) : state.nav.area === "library" && areaGate.ok ? (
                  <LibraryAreaList />
                ) : state.nav.area === "media" && areaGate.ok ? (
                  <MediaList />
                ) : state.nav.area === "learning" && areaGate.ok ? (
                  <LearningSidebar />
                ) : (
                  <Pane>
                    <PaneHeader title={current.title} />
                    <StatePanel
                      state="forbidden"
                      hint={areaGate.ok ? undefined : areaGate.reason}
                    />
                  </Pane>
                )
              }
            >
              {adminOpen ? (
                workbench.content
              ) : !areaGate.ok ? (
                <EmptyPane icon="lock" />
              ) : state.nav.area === "ai" ? (
                <AiContent />
              ) : state.nav.area === "chat" ? (
                <ChatContent />
              ) : state.nav.area === "learning" ? (
                <LearningScreen />
              ) : state.nav.area === "library" ? (
                <LibraryAreaContent />
              ) : (
                <MediaContent />
              )}
            </AppFrame>
            <ChatBackground />
            <LibraryBackground />
            <MediaBackground />
            <SettingsSheet
              open={overlay?.kind === "settings"}
              onClose={close}
            />
            <StatusCenter
              open={overlay?.kind === "status"}
              model={state.status}
              onClose={close}
            />
            <TasksSheet open={overlay?.kind === "tasks"} onClose={close} />
          </div>
        )}
        <LearningOverlays />
        {!isApp && !state.concealed && (
          <StatusCenter
            open={gateStatus}
            model={state.status}
            onClose={() => setGateStatus(false)}
          />
        )}
      </>
    </TalosProvider>
  );
}
