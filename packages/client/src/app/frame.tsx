import "./app.css";
import { AiList, AiContent } from "../features/ai/index.ts";
import {
  ActivityCenter,
  useActivityCounts,
  VersionRejectedPrompt,
} from "../features/activity/index.ts";
import { LibraryBackground } from "../features/library/index.ts";
import {
  LibraryAreaContent,
  LibraryAreaList,
  adminExtensions,
} from "./areas.tsx";
import { LauncherEntry } from "./launcher.tsx";
import { RecentList, RecentTracker } from "./recent.tsx";
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
import { StatePanel, StatusPill } from "../ui/feedback/index.ts";
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
  recent: {
    title: "最近",
    icon: "history",
    hint: "选择一个项目",
    list: "collection",
  },
  library: {
    title: "阅读",
    icon: "library",
    hint: "选择一份文档",
    list: "collection",
  },
  media: { title: "音乐", icon: "media", hint: "", list: "nav" },
  ai: { title: "AI", icon: "ai", hint: "开始一段新对话", list: "collection" },
  admin: { title: "管理", icon: "admin", hint: "", list: "nav" },
};
/** The administration area sits with the tools at the foot of the rail. */
const TOP_AREAS = AREA_IDS.filter((area) => area !== "admin");
/** Immersive pages hide the list pane: an open document. */
function isFocus(area: AreaId, top: Page | undefined): boolean {
  return area === "library" && top?.kind === "document";
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
  const runtime = useRuntime();
  useClientSnapshot();
  const systemMode = useSystemMode();
  const preferred = runtime.setting<string>("theme", "system");
  const mode =
    preferred === "dark" || preferred === "light" ? preferred : systemMode;
  return (
    <TalosProvider
      mode={mode}
      className={
        runtime.setting<string>("textSize", "normal") === "large"
          ? "text-large"
          : ""
      }
    >
      <MediaPlayerProvider>
        <AppContent />
      </MediaPlayerProvider>
    </TalosProvider>
  );
}
function AppContent(): ReactElement {
  const runtime = useRuntime();
  const state = useClientSnapshot();
  useEffect(() => runtime.stableGate(), [runtime, state.gate]);
  const admin = useGate("admin");
  const offline = useGate("offline");
  const areaGates = {
    chat: { ok: true as const },
    recent: { ok: true as const },
    library: useGate("articles"),
    media: useGate("media"),
    ai: useGate("ai"),
    admin,
  };
  const areaGate = areaGates[state.nav.area];
  const chatUnread = useChatUnread();
  const [gateStatus, setGateStatus] = useState(false);
  const activityCounts = useActivityCounts(state.status);
  const current = areas[state.nav.area];
  const stack = state.nav.areas[state.nav.area].stack;
  const top = stack[stack.length - 1];
  const overlay = state.nav.overlays[state.nav.overlays.length - 1];
  // Opening a section shows it on a narrow, stacked window; back returns to the list.
  const workbench = useAdminWorkbench(adminExtensions, (id) => {
    if (state.nav.areas.admin.stack.length === 1)
      runtime.dispatch({
        type: "pushPage",
        area: "admin",
        page: { kind: "page", id: `section:${id}` },
      });
  });
  const close = () => runtime.dispatch({ type: "closeOverlay" });
  const open = (kind: "settings" | "status") =>
    runtime.dispatch({ type: "openOverlay", overlay: { kind } });
  const switchArea = (area: AreaId) =>
    runtime.dispatch({ type: "switchArea", area });
  const isApp = state.gate === "app";
  return (
    <>
      <VersionRejectedPrompt />
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
            listKind={areas[state.nav.area].list}
            focus={isFocus(state.nav.area, top)}
            detail={stack.length > 1}
            onBack={() => runtime.dispatch({ type: "back" })}
            rail={
              <Rail>
                {TOP_AREAS.filter((area) => areaGates[area].ok).map((area) => (
                  <RailItem
                    key={area}
                    label={areas[area].title}
                    icon={<Icon name={areas[area].icon} size={22} />}
                    selected={state.nav.area === area}
                    badge={area === "chat" ? chatUnread : undefined}
                    onClick={() => switchArea(area)}
                  />
                ))}
                <RailSpacer />
                <MediaMiniPlayer />
                <StatusPill
                  rail
                  model={{ ...state.status, ...activityCounts }}
                  onClick={() => open("status")}
                />
                <LauncherEntry
                  areas={AREA_IDS.filter((area) => areaGates[area].ok).map(
                    (area) => ({ id: area, title: areas[area].title }),
                  )}
                />
                <RailItem
                  label="设置"
                  icon={<Icon name="settings" size={22} />}
                  onClick={() => open("settings")}
                />
                {admin.ok && (
                  <RailItem
                    label={areas.admin.title}
                    icon={<Icon name={areas.admin.icon} size={22} />}
                    selected={state.nav.area === "admin"}
                    onClick={() => switchArea("admin")}
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
              state.nav.area === "admin" && areaGate.ok ? (
                workbench.list
              ) : state.nav.area === "ai" ? (
                <AiList />
              ) : state.nav.area === "chat" ? (
                <ChatList />
              ) : state.nav.area === "recent" ? (
                <RecentList />
              ) : state.nav.area === "library" && areaGate.ok ? (
                <LibraryAreaList />
              ) : state.nav.area === "media" && areaGate.ok ? (
                <MediaList />
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
            {!areaGate.ok ? (
              <EmptyPane icon="lock" />
            ) : state.nav.area === "admin" ? (
              workbench.content
            ) : state.nav.area === "ai" ? (
              <AiContent />
            ) : state.nav.area === "chat" ? (
              <ChatContent />
            ) : state.nav.area === "recent" ? (
              <EmptyPane icon="history" hint={areas.recent.hint} />
            ) : state.nav.area === "library" ? (
              <LibraryAreaContent />
            ) : (
              <MediaContent />
            )}
          </AppFrame>
          <ChatBackground />
          <RecentTracker />
          <LibraryBackground />
          <MediaBackground />
          <SettingsSheet open={overlay?.kind === "settings"} onClose={close} />
          <ActivityCenter open={overlay?.kind === "status"} onClose={close} />
        </div>
      )}
      {!isApp && !state.concealed && (
        <ActivityCenter
          open={gateStatus}
          onClose={() => setGateStatus(false)}
        />
      )}
    </>
  );
}
