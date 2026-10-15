import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/frame.tsx";
import { createClientRuntime } from "./app/runtime.ts";
import { RuntimeProvider } from "./platform/react/context.tsx";
import { AppInteractionGuard } from "./app/interaction-guard.tsx";
const runtime = createClientRuntime();
function Root() {
  useEffect(() => {
    void runtime.start();
    return () => {
      void runtime.close();
    };
  }, []);
  return (
    <RuntimeProvider runtime={runtime}>
      <AppInteractionGuard />
      <App />
    </RuntimeProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Root />);
