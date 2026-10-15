import { describe, expect, it, vi } from "vitest";
import { fakeModel } from "../testing/provider.ts";
import type { ProviderEvent } from "./responses.ts";
import { ResponsesProvider, usageCost } from "./responses.ts";
const config = {
  baseURL: "https://example.test/v1",
  key: "private-key",
  models: [fakeModel],
};
function response(text: string, chunk = 7) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += chunk)
          c.enqueue(bytes.subarray(i, i + chunk));
        c.close();
      },
    }),
  );
}
const req = {
  user: "user",
  model: fakeModel,
  items: [
    {
      role: "user",
      content: [
        { type: "input_image", image_url: "data:image/png;base64,eA==" },
        { type: "input_text", text: "问题" },
      ],
    },
  ],
  tools: [],
  signal: new AbortController().signal,
};
async function collect(provider: ResponsesProvider) {
  const result: ProviderEvent[] = [];
  for await (const event of provider.stream(req)) result.push(event);
  return result;
}
describe("real Responses protocol over fetch", () => {
  it("decodes arbitrary SSE and UTF-8 boundaries, images, usage and tool calls", async () => {
    const fetcher = vi.fn(async () =>
      response(
        "data: " +
          JSON.stringify({
            type: "response.output_text.delta",
            delta: "中文",
          }) +
          "\r\n\r\ndata: " +
          JSON.stringify({
            type: "response.completed",
            response: {
              usage: {
                input_tokens: 10,
                output_tokens: 5,
                input_tokens_details: { cached_tokens: 3 },
              },
              output: [
                {
                  type: "function_call",
                  call_id: "call",
                  name: "create_file",
                  arguments: "{}",
                },
              ],
            },
          }) +
          "\n\n",
      ),
    );
    const provider = new ResponsesProvider(config, fetcher);
    expect(await collect(provider)).toEqual([
      { type: "text", text: "中文" },
      { type: "usage", usage: { input: 10, cached: 3, output: 5 } },
      {
        type: "tool",
        call: { id: "call", name: "create_file", arguments: "{}" },
      },
    ]);
    const invocation = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(invocation[0]).toBe("https://example.test/v1/responses");
    const body = JSON.parse(invocation[1].body as string) as {
      store: boolean;
      stream: boolean;
      safety_identifier: string;
      input: unknown;
    };
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.input).toEqual(req.items);
    expect(body.safety_identifier).toHaveLength(32);
  });
  it.each([429, 401, 500])(
    "maps HTTP %s without leaking upstream response",
    async (status) => {
      const p = new ResponsesProvider(
        config,
        async () => new Response("secret", { status }),
      );
      await expect(collect(p)).rejects.toMatchObject({
        code: status === 429 ? "E_BUSY" : "E_UNAVAILABLE",
      });
    },
  );
  it("rejects truncated completion rather than claiming success", async () => {
    const p = new ResponsesProvider(config, async () =>
      response('data: {"type":"response.output_text.delta","delta":"a"}\n\n'),
    );
    await expect(collect(p)).rejects.toThrow("未完成");
  });
  it("does not retry or change models after visible output", async () => {
    const fetcher = vi.fn(async () =>
      response(
        'data: {"type":"response.output_text.delta","delta":"a"}\n\ndata: {"type":"response.failed"}\n\n',
      ),
    );
    await expect(
      collect(new ResponsesProvider(config, fetcher)),
    ).rejects.toThrow("中断");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("separately prices cached input with integer microcredits", () =>
    expect(
      usageCost(
        {
          name: "x",
          maxOutput: 10,
          inputPrice: 3,
          cachedPrice: 1,
          outputPrice: 5,
        },
        { input: 100, cached: 20, output: 10 },
      ),
    ).toBe(310));
});
