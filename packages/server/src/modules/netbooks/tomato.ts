import type { CancellationSignal } from "@talos/base";
import { AppError } from "@talos/base";
import { load } from "cheerio";
import { z } from "zod";
import type { Netbook } from "@talos/contract";
import type { Catalog, NetbooksProvider } from "./provider.ts";
import {
  READER_CHARSET,
  READER_PUA_START,
  SEARCH_CHARSET,
  SEARCH_PUA_START,
} from "./charset.ts";
export function decode(value: string, search = false): string {
  const chars = search ? SEARCH_CHARSET : READER_CHARSET,
    start = search ? SEARCH_PUA_START : READER_PUA_START;
  return Array.from(value)
    .map((c) => {
      const n = c.codePointAt(0)! - start;
      return n >= 0 && n < chars.length && chars[n] !== "?" ? chars[n] : c;
    })
    .join("");
}
const searchPayload = z.object({
  data: z.object({
    search_book_data_list: z.array(
      z.object({
        book_id: z.union([z.string(), z.number()]),
        book_name: z.string(),
        author: z.string().default(""),
        book_abstract: z.string().default(""),
      }),
    ),
  }),
});
/** Official HTTP endpoints only; no embedded credentials or browser automation. */
export class TomatoProvider implements NetbooksProvider {
  constructor(
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}
  private async text(
    route: string,
    signal: CancellationSignal,
  ): Promise<string> {
    const controller = new AbortController(),
      abort = () => controller.abort();
    signal.addEventListener("abort", abort);
    if (signal.aborted) abort();
    const timer = setTimeout(abort, 20000);
    try {
      const response = await this.request(`https://fanqienovel.com${route}`, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "zh-CN" },
      });
      if (response.status === 429) {
        const value = response.headers.get("retry-after");
        const seconds = Number(value);
        const delay =
          value && !Number.isFinite(seconds)
            ? Date.parse(value) - this.now()
            : (seconds || 5) * 1000;
        throw new AppError("E_BUSY", "番茄请求限流", {
          retryAt:
            this.now() + Math.max(5000, Number.isFinite(delay) ? delay : 5000),
        });
      }
      if (!response.ok)
        throw new AppError("E_UNAVAILABLE", `番茄返回 HTTP ${response.status}`);
      // Bound upstream bytes before parsing rather than trusting Content-Length.
      const reader = response.body?.getReader();
      if (!reader) throw new AppError("E_UNAVAILABLE", "番茄响应为空");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 4 * 1024 * 1024) {
          await reader.cancel();
          throw new AppError("E_TOO_LARGE", "番茄响应过大");
        }
        chunks.push(part.value);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      if (!body.trim())
        throw new AppError(
          "E_UNAVAILABLE",
          "番茄要求浏览器验证，HTTP 响应为空",
        );
      return body;
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (signal.aborted) throw new AppError("E_CANCELLED", "请求已取消");
      throw new AppError(
        controller.signal.aborted ? "E_TIMEOUT" : "E_UNAVAILABLE",
        "番茄请求失败，请稍后重试",
      );
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
  async search(query: string, signal: CancellationSignal): Promise<Netbook[]> {
    const text = await this.text(
      `/api/author/search/search_book/v1/?query=${encodeURIComponent(query)}&page_count=20&page_index=0`,
      signal,
    );
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new AppError("E_UNAVAILABLE", "番茄搜索要求验证或响应格式已变更");
    }
    const parsed = searchPayload.safeParse(payload);
    if (!parsed.success)
      throw new AppError("E_UNAVAILABLE", "番茄搜索响应格式已变更");
    return parsed.data.data.search_book_data_list
      .filter((b) => /^\d{1,30}$/.test(String(b.book_id)))
      .slice(0, 20)
      .map((b) => ({
        id: String(b.book_id),
        title: decode(b.book_name, true).slice(0, 200),
        author: decode(b.author, true).slice(0, 200),
        abstract: decode(b.book_abstract, true).slice(0, 80),
      }));
  }
  async catalog(book: string, signal: CancellationSignal): Promise<Catalog> {
    const $ = load(await this.text(`/page/${book}`, signal));
    const chapters: Catalog["chapters"] = [],
      seen = new Set<string>();
    $("div.chapter a[href^='/reader/']").each((_, element) => {
      const id = $(element)
        .attr("href")
        ?.match(/\/reader\/(\d+)/)?.[1];
      if (id && !seen.has(id)) {
        seen.add(id);
        chapters.push({ id, title: decode($(element).text().trim()) });
      }
    });
    if (!chapters.length)
      throw new AppError(
        "E_UNAVAILABLE",
        "番茄目录为空，页面结构已变更或需要验证",
      );
    return { title: decode($("h1").first().text().trim()) || book, chapters };
  }
  async chapter(id: string, signal: CancellationSignal): Promise<string> {
    const $ = load(await this.text(`/reader/${id}`, signal));
    const node = $(".muye-reader-content");
    const text = decode(
      node
        .find("p")
        .toArray()
        .map((p) => $(p).text())
        .join("\n") || node.text(),
    );
    if (
      !text.trim() ||
      /会员登录后|阅读全文|下载番茄小说|网页畅读|扫码下载APP/.test(text)
    )
      throw new AppError("E_UNAVAILABLE", "章节未提供完整正文，请稍后重试");
    return text;
  }
}
