import { memo, useState } from "react";
import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { Dialog } from "../../../ui/overlays/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import type { AiRenderer } from "../model/blocks.ts";
import "./ai.css";
const Block = memo(function Block({
  text,
  renderer,
}: {
  text: string;
  renderer: AiRenderer;
}): ReactElement {
  return <div dangerouslySetInnerHTML={{ __html: renderer.render(text) }} />;
});
export function RichTextView({
  text,
  blocks,
  tail,
  renderer,
  error,
  onOpenLink,
}: {
  text: string;
  blocks: readonly string[];
  tail: string;
  /** Absent until the renderer bundle has loaded; the plain text shows meanwhile. */
  renderer: AiRenderer | undefined;
  error: string;
  onOpenLink: (url: string) => void;
}): ReactElement {
  const [link, setLink] = useState("");
  return (
    <div
      className="ai-rich selectable"
      data-testid="ai.message.rich"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        if (a) {
          e.preventDefault();
          setLink(a.href);
        }
      }}
    >
      {!renderer ? (
        <>
          {error && <StatePanel state="offline" hint={error} />}
          <pre>{text}</pre>
        </>
      ) : (
        <>
          {blocks.map((block, i) => (
            <Block key={i} text={block} renderer={renderer} />
          ))}
          {tail && <p className="ai-stream-tail">{tail}</p>}
        </>
      )}
      <Dialog
        open={!!link}
        title="打开外部链接"
        onClose={() => setLink("")}
        footer={
          <>
            <Button onClick={() => setLink("")}>取消</Button>
            <Button
              variant="primary"
              onClick={() => {
                onOpenLink(link);
                setLink("");
              }}
            >
              打开链接
            </Button>
          </>
        }
      >
        <p>即将访问：{link}</p>
        <p>外部网站可能无法在离线时访问。</p>
      </Dialog>
    </div>
  );
}
