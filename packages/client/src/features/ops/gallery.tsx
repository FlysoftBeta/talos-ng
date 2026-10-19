import type { ReactElement } from "react";
import type { Method } from "@talos/contract";
import { opsPanels, OpsPortProvider } from "./index.ts";
import type { OpsPort } from "./model/port.ts";
import { TalosProvider } from "../../ui/theme/index.ts";
const rows: Record<string, unknown> = {
  "ops.settings.get": {
    retention: 5,
    daily: true,
    cloudEnabled: true,
    autoCheck: true,
    manifestUrl: "https://updates.example.org/talos/manifest.json",
  },
  "ops.backup.list": [
    {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      created: 1789430400000,
      size: 31719424,
    },
  ],
  "ops.update.status": {
    build: "2026-10-13",
    phase: "idle",
    candidate: null,
    progress: 0,
    lastError: null,
    launcher: true,
  },
  "ops.https.status": {
    domain: "talos.school.example",
    expiry: 1798761600000,
    redirect: true,
    ca: true,
    listeners: [
      { port: 8080, secure: false, host: "0.0.0.0" },
      { port: 8443, secure: true, host: "0.0.0.0" },
    ],
  },
  "ops.host.status": { available: true, shutdownAt: null },
  "ops.office.list": {
    available: true,
    files: [
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        name: "高三语文复习资料——古代诗歌鉴赏与现代文阅读训练（教师修订版）.docx",
        application: "WPS 文字",
        kind: "word",
        objectId: "a".repeat(64),
        size: 312344,
        created: 1789430400000,
      },
    ],
  },
};
export function OpsGallery({
  panel,
  mode = "light",
  offline = false,
}: {
  panel: string;
  mode?: "light" | "dark";
  offline?: boolean;
}): ReactElement {
  const Component =
    opsPanels.find((p) => p.id === panel)?.component ?? opsPanels[0]!.component;
  const port: OpsPort = {
    can: () =>
      offline ? { ok: false, reason: "此操作需要连接服务器" } : { ok: true },
    subscribe: () => () => undefined,
    command: async (method: Method) => {
      const value = rows[method.name];
      if (value !== undefined) return value as never;
      throw new Error("组件预览不会执行服务器操作");
    },
  };
  return (
    <TalosProvider mode={mode}>
      <OpsPortProvider key={String(offline)} port={port}>
        <main className="ops-gallery">
          <Component />
        </main>
      </OpsPortProvider>
    </TalosProvider>
  );
}
