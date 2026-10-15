import { useEffect } from "react";
import {
  useRuntime,
  useClientSnapshot,
} from "../../../platform/react/context.tsx";
import { CachedImageController, StickerController } from "../model/media.ts";
import {
  CachedImageView,
  OriginalViewerView,
  StickerPickerView,
} from "../view/media.tsx";
import type {
  CachedImageProps,
  OriginalViewerProps,
  StickerPickerProps,
} from "../view/media.tsx";
import { imageUrls } from "../adapters/browser.ts";
import { useController } from "../../../platform/react/use-controller.ts";
export function CachedImage(props: CachedImageProps) {
  const runtime = useRuntime();
  useClientSnapshot();
  const [model] = useController(
    () =>
      new CachedImageController(
        runtime,
        imageUrls,
        props.file,
        props.conversation,
      ),
  );
  const state = model.presentation();
  useEffect(() => {
    model.update(props.file, props.conversation);
    return model.dispose;
  }, [model, props.file.rid, props.conversation, state.can.ok]);
  return <CachedImageView {...props} {...state} />;
}
export function OriginalViewer(props: OriginalViewerProps) {
  return <OriginalViewerView {...props} CachedImage={CachedImage} />;
}
export function StickerPicker(props: StickerPickerProps) {
  const runtime = useRuntime();
  useClientSnapshot();
  const [model] = useController(() => new StickerController(runtime));
  const state = model.presentation();
  useEffect(() => {
    model.update(props.open);
    return model.dispose;
  }, [model, props.open, state.can.ok]);
  return (
    <StickerPickerView
      {...state}
      {...props}
      onPick={(sticker) => model.pick(sticker, props.onPick, props.onClose)}
      CachedImage={CachedImage}
    />
  );
}
