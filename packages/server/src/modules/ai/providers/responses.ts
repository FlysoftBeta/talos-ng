import { AppError, sha256Hex, utf8Encode } from "@talos/base";
import { z } from "@talos/contract";
export interface Model {
  name: string;
  inputPrice: number;
  cachedPrice: number;
  outputPrice: number;
  maxOutput: number;
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export interface Usage {
  input: number;
  cached: number;
  output: number;
}
export interface ProviderRequest {
  user: string;
  model: Model;
  items: readonly Record<string, unknown>[];
  tools: readonly Record<string, unknown>[];
  signal: AbortSignal;
}
export type ProviderEvent =
  | { type: "text"; text: string }
  | { type: "tool"; call: ToolCall }
  | { type: "usage"; usage: Usage };
export interface ModelProvider {
  readonly models: readonly Model[];
  stream(request: ProviderRequest): AsyncIterable<ProviderEvent>;
}
const modelSchema = z.object({
  name: z.string().min(1),
  inputPrice: z.number().nonnegative().max(10000),
  cachedPrice: z.number().nonnegative().max(10000),
  outputPrice: z.number().nonnegative().max(10000),
  maxOutput: z.number().int().min(1).max(16384),
});
const configSchema = z.object({
  baseURL: z.string().url(),
  key: z.string().min(1),
  models: z.array(modelSchema).min(1).max(10),
});
const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  input_tokens_details: z
    .object({ cached_tokens: z.number().int().nonnegative() })
    .optional(),
});
const callSchema = z.object({
  type: z.literal("function_call"),
  call_id: z.string(),
  name: z.string(),
  arguments: z.string().max(200000),
});
/** Responses SSE over fetch. No credentials, prompts or upstream errors reach clients. */
export class ResponsesProvider implements ModelProvider {
  readonly models: readonly Model[];
  private readonly config: z.infer<typeof configSchema>;
  constructor(
    config: unknown,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.config = configSchema.parse(config);
    this.models = this.config.models;
    const url = new URL(this.config.baseURL);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new AppError("E_INVALID", "AI 地址无效");
  }
  async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    let response: Response;
    try {
      response = await this.fetcher(
        this.config.baseURL.replace(/\/$/, "") + "/responses",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.key}`,
            "Content-Type": "application/json",
          },
          signal: request.signal,
          body: JSON.stringify({
            model: request.model.name,
            store: false,
            stream: true,
            max_output_tokens: request.model.maxOutput,
            safety_identifier: sha256Hex(utf8Encode(request.user)).slice(0, 32),
            input: request.items,
            tools: request.tools,
            parallel_tool_calls: false,
            instructions:
              "用中文回答。文件工具只能操作用户工作区。不要执行代码。",
          }),
        },
      );
    } catch {
      throw new AppError(
        request.signal.aborted ? "E_CANCELLED" : "E_UNAVAILABLE",
        request.signal.aborted ? "生成已停止" : "AI 服务连接失败",
      );
    }
    if (!response.ok || !response.body)
      throw new AppError(
        response.status === 429 ? "E_BUSY" : "E_UNAVAILABLE",
        response.status === 429 ? "AI 服务繁忙，请稍后重试" : "AI 服务暂不可用",
      );
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let pending = "",
      completed = false;
    try {
      for (;;) {
        const chunk = await reader.read();
        pending += decoder.decode(chunk.value ?? new Uint8Array(), {
          stream: !chunk.done,
        });
        pending = pending.replace(/\r\n/g, "\n");
        if (pending.length > 2_000_000)
          throw new AppError("E_TOO_LARGE", "AI 流数据过大");
        let end: number;
        while ((end = pending.indexOf("\n\n")) >= 0) {
          const block = pending.slice(0, end);
          pending = pending.slice(end + 2);
          const data = block
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (!data || data === "[DONE]") continue;
          const event = z
            .object({
              type: z.string(),
              delta: z.string().optional(),
              response: z.unknown().optional(),
            })
            .parse(JSON.parse(data) as unknown);
          if (event.type === "response.output_text.delta" && event.delta)
            yield { type: "text", text: event.delta };
          if (
            event.type === "error" ||
            event.type === "response.failed" ||
            event.type === "response.incomplete"
          )
            throw new AppError("E_UNAVAILABLE", "AI 生成中断，请重试");
          if (event.type === "response.completed") {
            const result = z
              .object({ usage: usageSchema, output: z.array(z.unknown()) })
              .parse(event.response);
            completed = true;
            yield {
              type: "usage",
              usage: {
                input: result.usage.input_tokens,
                cached: result.usage.input_tokens_details?.cached_tokens ?? 0,
                output: result.usage.output_tokens,
              },
            };
            for (const item of result.output) {
              const call = callSchema.safeParse(item);
              if (call.success)
                yield {
                  type: "tool",
                  call: {
                    id: call.data.call_id,
                    name: call.data.name,
                    arguments: call.data.arguments,
                  },
                };
            }
          }
        }
        if (chunk.done) break;
      }
      if (!completed) throw new AppError("E_UNAVAILABLE", "AI 流未完成");
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(
        request.signal.aborted ? "E_CANCELLED" : "E_UNAVAILABLE",
        "AI 生成中断，请重试",
      );
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}
export function usageCost(model: Model, u: Usage): number {
  return Math.ceil(
    Math.max(0, u.input - u.cached) * model.inputPrice +
      Math.min(u.cached, u.input) * model.cachedPrice +
      u.output * model.outputPrice,
  );
}
