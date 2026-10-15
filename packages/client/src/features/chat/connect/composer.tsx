import { useEffect } from "react";
import {
  useRuntime,
  useClientSnapshot,
} from "../../../platform/react/context.tsx";
import { ComposerController } from "../model/composer.ts";
import type { ComposerInput } from "../model/composer.ts";
import { ComposerView } from "../view/composer.tsx";
import { imageSource } from "../adapters/browser.ts";
import { StickerPicker } from "./media.tsx";
import { useController } from "../../../platform/react/use-controller.ts";
export function Composer(input: ComposerInput) {
  const runtime = useRuntime();
  useClientSnapshot();
  const [model] = useController(() => new ComposerController(runtime, input));
  useEffect(model.start, [model]);
  useEffect(
    () => model.update(input),
    [model, input.group, input.state, input.reply, input.onReplyClear],
  );
  return (
    <ComposerView
      {...model.presentation()}
      onFile={(file) => void model.image(imageSource(file))}
      StickerPicker={StickerPicker}
    />
  );
}
