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
export function PostCard(props: PostCardProps) {
  const runtime = useRuntime();
  useClientSnapshot();
  const [model] = useController(
    () => new PostCardController(runtime, copyText),
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
