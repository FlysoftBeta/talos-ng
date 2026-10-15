import MarkdownIt from "markdown-it";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { AiRenderer } from "../model/blocks.ts";
declare global {
  interface Window {
    __talosAiRenderer?: AiRenderer;
  }
}
const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});
markdown.validateLink = (url) => /^(https?:|mailto:)/i.test(url);
markdown.renderer.rules.image = (tokens, index) =>
  `<span>[图片：${markdown.utils.escapeHtml(tokens[index]!.content)}]</span>`;
const fence = markdown.renderer.rules.fence!;
markdown.renderer.rules.fence = (tokens, index, options, env, self) =>
  tokens[index]!.info.trim() === "mermaid"
    ? `<figure><figcaption>Mermaid 图表源码（兼容模式）</figcaption><pre><code>${markdown.utils.escapeHtml(tokens[index]!.content)}</code></pre></figure>`
    : fence(tokens, index, options, env, self);
markdown.block.ruler.before(
  "fence",
  "display_math",
  (state, startLine, endLine, silent) => {
    const first = state.src.slice(
      state.bMarks[startLine]! + state.tShift[startLine]!,
      state.eMarks[startLine]!,
    );
    if (first.trim() !== "$$") return false;
    let end = startLine + 1;
    while (
      end < endLine &&
      state.src.slice(state.bMarks[end]!, state.eMarks[end]!).trim() !== "$$"
    )
      end++;
    if (end === endLine) return false;
    if (silent) return true;
    const token = state.push("math", "", 0);
    token.block = true;
    token.content = state.getLines(startLine + 1, end, 0, false);
    state.line = end + 1;
    return true;
  },
);
markdown.inline.ruler.before("escape", "math", (state, silent) => {
  const start = state.pos;
  if (state.src[start] !== "$") return false;
  const double = state.src[start + 1] === "$",
    delimiter = double ? "$$" : "$",
    end = state.src.indexOf(delimiter, start + delimiter.length);
  if (end < 0 || end === start + delimiter.length) return false;
  if (!silent) {
    const token = state.push("math", "", 0);
    token.content = state.src.slice(start + delimiter.length, end);
    token.block = double;
  }
  state.pos = end + delimiter.length;
  return true;
});
markdown.renderer.rules.math = (tokens, index) =>
  katex.renderToString(tokens[index]!.content, {
    displayMode: tokens[index]!.block,
    throwOnError: false,
    trust: false,
    strict: "ignore",
    maxExpand: 200,
    maxSize: 20,
    output: "html",
  });
window.__talosAiRenderer = { render: (text) => markdown.render(text) };
