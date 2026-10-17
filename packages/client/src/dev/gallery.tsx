import { OverlayBench } from "./overlay-bench.tsx";
import { OpsGallery } from "../features/ops/gallery.tsx";
import { DataGridGallery } from "./data-grid-gallery.tsx";
import { VirtualBench } from "./virtual-bench.tsx";
import { createRoot } from "react-dom/client";
import { AuthShowcase } from "./auth-showcase.tsx";
import { Showcase } from "./showcase.tsx";
import { AuthScreen, DeviceLockedScreen } from "../features/auth/index.ts";
import { TalosProvider } from "../ui/theme/index.ts";
import type { StatusViewModel } from "../core/status/model.ts";
const query = new URLSearchParams(location.search);
const preview = query.get("auth");
const errors: Record<string, string> = {
  "wrong-pin": "PIN 不正确，请重试",
  throttled: "尝试次数过多，请稍后再试",
  "offline-unavailable": "此账户尚未在本机登录，请联网后首次登录",
};
const admissionReasons = [
  "whitelist-required",
  "bound-to-other-user",
  "invalid-client",
  "system-lock",
  "idle-lock",
  "banned",
  "throttled",
] as const;
const admission = admissionReasons.find((reason) => reason === preview);
const model: StatusViewModel = {
  connection: preview === "offline-unavailable" ? "offline" : "connected",
  lastSync: "刚刚",
  pending: 0,
  failed: 0,
  operations: [],
  scopes: [],
  transfers: [],
  storage: "尚未读取",
  build: __BUILD_ID__,
  update: { state: "none" },
};
createRoot(document.getElementById("root")!).render(
  query.has("overlays") ? (
    <OverlayBench dark={query.get("theme") === "dark"} />
  ) : query.has("virtual") ? (
    <VirtualBench end={query.has("end")} />
  ) : query.has("grid") ? (
    <DataGridGallery mode={query.get("theme") === "dark" ? "dark" : "light"} />
  ) : query.has("ops") ? (
    <OpsGallery
      panel={query.get("ops")!}
      mode={query.get("theme") === "dark" ? "dark" : "light"}
      offline={query.has("offline")}
    />
  ) : preview ? (
    <TalosProvider mode={query.get("theme") === "dark" ? "dark" : "light"}>
      {["onboarding", "pins", "invitation", "reset"].includes(preview) ? (
        <AuthShowcase preview={preview} status={model} />
      ) : preview === "device-locked" ||
        preview === "denied-logout" ||
        admission ? (
        <DeviceLockedScreen
          device="gallery-tablet-01"
          logout={
            preview === "denied-logout"
              ? { name: "林同学", run: async () => {} }
              : undefined
          }
          admission={{
            reason: admission || "whitelist-required",
            ...(admission === "throttled"
              ? { retryAt: Date.now() + 900000 }
              : {}),
          }}
        />
      ) : (
        <AuthScreen
          locked={preview === "lock"}
          name="林同学"
          device="gallery-tablet-01"
          status={model}
          error={errors[preview]}
          onLogin={() => {}}
        />
      )}
    </TalosProvider>
  ) : (
    <Showcase gallery />
  ),
);
