import { guardConverter } from "../conversion/errors.ts";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { AppError, utf8Encode } from "@talos/base";
import { MAX_RESOURCE_BYTES } from "@talos/docpack";
import type { OutlineEntry } from "@talos/docpack";
import type { Converter } from "../conversion/ports.ts";
import { checkAbort } from "../conversion/ports.ts";
import { writePack } from "../conversion/write-pack.ts";
export function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      text = new TextDecoder("gb18030", { fatal: true }).decode(bytes);
    } catch {
      throw new AppError("E_INVALID", "无法识别的文本编码");
    }
  }
  return text.replace(/\0/g, "").replace(/\r\n?/g, "\n").trim();
}
export interface TextSegment {
  offset: number;
  text: string;
}
/** Preserves all normalized characters; boundaries prefer paragraphs, then sentences. */
export function segmentText(
  text: string,
  target = 8000,
  cap = 16000,
): TextSegment[] {
  if (
    !Number.isInteger(target) ||
    !Number.isInteger(cap) ||
    target < 2 ||
    cap < target ||
    cap > 16000
  )
    throw new AppError("E_INVALID", "无效的文本分段长度");
  const result: TextSegment[] = [];
  let start = 0;
  while (start < text.length) {
    const hard = Math.min(text.length, start + cap);
    let end = Math.min(text.length, start + target);
    if (end < text.length) {
      const before = text.lastIndexOf("\n", end - 1);
      const after = text.indexOf("\n", end);
      if (before >= start + target / 2) end = before + 1;
      else if (after >= 0 && after < hard) end = after + 1;
      else {
        let sentence = -1;
        for (let i = end - 1; i >= start + target / 2; i--)
          if (
            /[。！？!?]/.test(text[i]!) ||
            (text[i] === "." && /\s/.test(text[i + 1] ?? ""))
          ) {
            sentence = i + 1;
            break;
          }
        if (sentence > 0) end = sentence;
      }
    }
    if (
      end < text.length &&
      /[\uD800-\uDBFF]/.test(text[end - 1]!) &&
      /[\uDC00-\uDFFF]/.test(text[end]!)
    )
      end--;
    result.push({ offset: start, text: text.slice(start, end) });
    start = end;
  }
  return result;
}
export function textOutline(
  text: string,
  segments: readonly TextSegment[],
): OutlineEntry[] {
  const outline: OutlineEntry[] = [];
  let offset = 0,
    ordinal = 0;
  for (const line of text.split("\n")) {
    const title = line.trim();
    if (
      title.length <= 200 &&
      /^(?:第[^\s]{1,30}[章节回]|Chapter\s+\d+\b|#{1,6}\s+\S)/i.test(title)
    ) {
      while (
        ordinal + 1 < segments.length &&
        segments[ordinal + 1]!.offset <= offset
      )
        ordinal++;
      outline.push({
        title: title.replace(/^#{1,6}\s+/, ""),
        ordinal,
        level: title.match(/^#+/)?.[0].length ?? 1,
      });
    }
    offset += line.length + 1;
  }
  return outline;
}
export function createTextConverter(): Converter {
  return guardConverter({
    id: "text",
    detect: (head, name, mime) => {
      if (
        head.length >= 3 &&
        head[0] === 0xef &&
        head[1] === 0xbb &&
        head[2] === 0xbf
      )
        return true;
      return (
        /\.(txt|text|md)$/i.test(name) ||
        /^text\/(plain|markdown)(?:;|$)/i.test(mime ?? "")
      );
    },
    convert: async (input, sink, ctx) => {
      checkAbort(ctx.signal);
      if ((await stat(input.path)).size > MAX_RESOURCE_BYTES)
        throw new AppError("E_TOO_LARGE", "文档过大");
      const text = decodeText(
        await readFile(input.path, { signal: ctx.signal }),
      );
      checkAbort(ctx.signal);
      if (!text) throw new AppError("E_INVALID", "文档没有内容");
      const segments = segmentText(text);
      const title = path.parse(input.name).name;
      const { bytes } = await writePack(
        sink,
        ctx,
        { kind: "flow", title, meta: { chars: text.length } },
        async (writer) => {
          for (let i = 0; i < segments.length; i++) {
            checkAbort(ctx.signal);
            const s = segments[i]!;
            const entry = await writer.addResource(
              utf8Encode(s.text),
              "text/plain; charset=utf-8",
            );
            writer.addUnit({
              id: `text-${i}`,
              entry,
              deps: [],
              chars: s.text.length,
            });
            ctx.progress(i + 1, segments.length);
          }
          writer.setOutline(textOutline(text, segments));
        },
      );
      return {
        kind: "flow",
        units: segments.length,
        title,
        bytes,
        warnings: [],
      };
    },
  });
}
