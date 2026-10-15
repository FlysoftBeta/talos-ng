import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { loadRenderer, openExternal } from "../adapters/rich-text-loader.ts";
import { IncrementalBlocks } from "../model/blocks.ts";
import type { AiRenderer } from "../model/blocks.ts";
import { RichTextView } from "../view/rich-text.tsx";

/** Loads the renderer on first display and feeds streamed text through the incremental block scanner. */
export function RichText({
  text,
  complete,
}: {
  text: string;
  complete: boolean;
}): ReactElement {
  const parser = useRef(new IncrementalBlocks()),
    [renderer, setRenderer] = useState<AiRenderer>(),
    [error, setError] = useState("");
  const parsed = parser.current.update(text, complete);
  useEffect(() => {
    let active = true;
    void loadRenderer()
      .then((r) => {
        if (active) setRenderer(r);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <RichTextView
      text={text}
      blocks={parsed.blocks}
      tail={parsed.tail}
      renderer={renderer}
      error={error}
      onOpenLink={openExternal}
    />
  );
}
