import type { ReactElement, ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import "./feedback.css";

export type ToastTone = "neutral" | "failed";
interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}
type Show = (text: string, tone?: ToastTone) => void;
const ToastContext = createContext<Show>(() => {});
let next = 1;
/** One toast at a time, bottom centre; the newest replaces the previous one. */
export function ToastHost({ children }: { children: ReactNode }): ReactElement {
  const [item, setItem] = useState<ToastItem>();
  const show = useCallback<Show>((text, tone = "neutral") => {
    setItem({ id: next++, text, tone });
  }, []);
  useEffect(() => {
    if (!item) return;
    const timer = setTimeout(
      () => setItem((current) => (current === item ? undefined : current)),
      item.tone === "failed" ? 5000 : 3000,
    );
    return () => clearTimeout(timer);
  }, [item]);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-host" aria-live="polite">
        {item && (
          <div
            key={item.id}
            className={`toast toast-${item.tone}`}
            role={item.tone === "failed" ? "alert" : "status"}
          >
            {item.text}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
/** Shows a short message (a disabled control's reason, a confirmation). */
export function useToast(): Show {
  return useContext(ToastContext);
}
