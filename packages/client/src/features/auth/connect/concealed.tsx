import { useRef } from "react";
import type { ReactElement } from "react";
import { ConcealedController } from "../model/concealment.ts";
import { ConcealedView } from "../view/concealed.tsx";
export function ConcealedScreen({
  onReveal,
  now,
}: {
  onReveal: () => void;
  now?: () => number;
}): ReactElement {
  const reveal = useRef(onReveal);
  reveal.current = onReveal;
  const controller = useRef<ConcealedController | undefined>(undefined);
  controller.current ??= new ConcealedController(() => reveal.current(), now);
  const c = controller.current;
  return (
    <ConcealedView
      onKey={(key) => c.key(key)}
      onTouch={(x, y) => c.touch(x, y, window.innerWidth, window.innerHeight)}
      onMouse={(x, y) => c.mouse(x, y, window.innerWidth, window.innerHeight)}
    />
  );
}
