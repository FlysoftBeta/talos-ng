import { createShellRuntime } from "./runtime.ts";

// Structural worker declarations avoid mixing conflicting DOM and WebWorker libs.
interface LifetimeEvent {
  waitUntil(promise: Promise<unknown>): void;
}
interface ShellWorkerScope {
  readonly location: { readonly origin: string };
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(
    type: "install" | "activate",
    handler: (event: LifetimeEvent) => void,
  ): void;
  addEventListener(
    type: "fetch",
    handler: (event: {
      readonly request: Request;
      respondWith(response: Promise<Response>): void;
    }) => void,
  ): void;
  addEventListener(
    type: "message",
    handler: (
      event: LifetimeEvent & {
        readonly data: unknown;
        readonly origin: string;
        readonly ports: readonly MessagePort[];
      },
    ) => void,
  ): void;
}
const scope = self as unknown as ShellWorkerScope;
const runtime = createShellRuntime({ origin: scope.location.origin });
scope.addEventListener("install", (event) =>
  event.waitUntil(scope.skipWaiting()),
);
scope.addEventListener("activate", (event) =>
  event.waitUntil(scope.clients.claim()),
);
scope.addEventListener("fetch", (event) => {
  const response = runtime.handleFetch(event.request);
  if (response) event.respondWith(response);
});
scope.addEventListener("message", (event) => {
  if (event.origin && event.origin !== scope.location.origin) return;
  event.waitUntil(
    runtime.handleMessage(event.data).then((result) => {
      event.ports[0]?.postMessage(result);
    }),
  );
});
