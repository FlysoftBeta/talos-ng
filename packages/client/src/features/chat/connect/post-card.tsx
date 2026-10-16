import { useEffect } from "react";
import {
  useRuntime,
  useClientSnapshot,
} from "../../../platform/react/context.tsx";
import { PostCardController } from "../model/post-card.ts";
import { copyText } from "../adapters/browser.ts";
import { PostCardView } from "../view/post-card.tsx";
import type { PostCardProps } from "../view/post-card.tsx";
import { CachedImage } from "./media.tsx";
import { useController } from "../../../platform/react/use-controller.ts";
import { useToast } from "../../../ui/feedback/toast.tsx";
export function PostCard(props: PostCardProps) {
  const runtime = useRuntime();
  const toast = useToast();
  useClientSnapshot();
  const [model] = useController(
    () =>
      new PostCardController(runtime, (text) => {
        void copyText(text).catch(() =>
          toast("无法复制，请选中文字后手动复制"),
        );
      }),
  );
  const { post } = props;
  useEffect(() => {
    model.update(post);
    return model.dispose;
  }, [model, post.id, post.pending, post.failed, post.kind]);
  return (
    <PostCardView
      {...props}
      {...model.presentation(post, props.reply)}
      CachedImage={CachedImage}
    />
  );
}
