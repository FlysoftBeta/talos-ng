import type { BrowserDiagnostics } from "../../core/status/diagnostics.ts";
export function installDiagnostics(
  diagnostics: BrowserDiagnostics,
): () => void {
  if (typeof window === "undefined") return () => {};
  const error = (event: ErrorEvent) =>
    diagnostics.capture(event.error, "error");
  const rejection = (event: PromiseRejectionEvent) =>
    diagnostics.capture(event.reason, "unhandledrejection");
  window.addEventListener("error", error);
  window.addEventListener("unhandledrejection", rejection);
  const timer = window.setInterval(() => void diagnostics.flush(), 5000);
  return () => {
    window.removeEventListener("error", error);
    window.removeEventListener("unhandledrejection", rejection);
    window.clearInterval(timer);
  };
}
