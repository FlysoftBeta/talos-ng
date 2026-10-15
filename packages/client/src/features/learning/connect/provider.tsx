import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactElement, ReactNode } from "react";
import { AppError } from "@talos/base";
import { useRuntime } from "../../../platform/react/context.tsx";
import { browserLearningHost } from "../adapters/browser-host.ts";
import { browserLearningTime } from "../adapters/browser-time.ts";
import { LearningController } from "../model/controller.ts";
import type { LearningHost, LearningState } from "../model/controller.ts";
import type { LearningTime } from "../model/time.ts";
export interface LearningContextValue extends LearningState {
  time: LearningTime;
  controller: LearningController;
}
const Context = createContext<LearningContextValue | null>(null);
export function useLearning(): LearningContextValue {
  const value = useContext(Context);
  if (!value) throw new AppError("E_INTERNAL", "缺少学习环境");
  return value;
}
export function LearningProvider({
  children,
  time = browserLearningTime,
  random = Math.random,
  host = browserLearningHost,
}: {
  children: ReactNode;
  time?: LearningTime;
  random?: () => number;
  host?: LearningHost;
}): ReactElement {
  const runtime = useRuntime();
  const [controller] = useState(
    () => new LearningController(runtime, host, time, random),
  );
  useEffect(() => {
    controller.attach();
    return () => controller.detach();
  }, [controller]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const value = useMemo(
    () => ({ ...state, time, controller }),
    [state, time, controller],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
