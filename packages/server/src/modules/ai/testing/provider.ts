import { AppError, sleep } from "@talos/base";
import type {
  Model,
  ModelProvider,
  ProviderEvent,
  ProviderRequest,
} from "../providers/responses.ts";
export const fakeModel: Model = {
  name: "deterministic-test",
  inputPrice: 1,
  cachedPrice: 0,
  outputPrice: 2,
  maxOutput: 1024,
};
export class FakeProvider implements ModelProvider {
  readonly models = [fakeModel];
  constructor(
    private readonly wait: (signal: AbortSignal) => Promise<void> = (signal) =>
      sleep(20, signal),
  ) {}
  async *stream(r: ProviderRequest): AsyncIterable<ProviderEvent> {
    const serialized = JSON.stringify(r.items);
    if (
      serialized.includes("创建文件") &&
      !r.items.some((i) => i.type === "function_call_output")
    ) {
      yield {
        type: "tool",
        call: {
          id: "create-note",
          name: "create_file",
          arguments: JSON.stringify({
            path: "笔记/学习.md",
            content: "# 学习笔记\n\n这是工具创建的文件。",
          }),
        },
      };
      yield { type: "usage", usage: { input: 10, cached: 0, output: 10 } };
      return;
    }
    const latestUser = r.items.findLast((item) => item.role === "user");
    if (JSON.stringify(latestUser ?? null).includes("持续生成")) {
      // Trickles slowly (5 chars / 20 ms: the 100 000-character answer limit is ~7 minutes away) so a
      // browser test can observe a running generation across a reconnect at any machine speed.
      // It ends only when the run is stopped.
      for (;;) {
        await this.wait(r.signal);
        if (r.signal.aborted) throw new AppError("E_CANCELLED", "生成已停止");
        yield { type: "text", text: "持续生成。" };
      }
    }
    const answer =
      "你好！这是逐步生成的中文回答。\n\n```js\nconst answer = 42;\n```\n\n公式：$x^2 + y^2 = z^2$。\n\n| 项目 | 结果 |\n| --- | --- |\n| 学习 | 完成 |\n\n```mermaid\ngraph LR\n A-->B\n```\n\n" +
      (serialized.includes("长回答")
        ? "平稳生成的长篇中文回答。\n\n".repeat(1600)
        : "可以继续提问，或打开工作区查看文件。");
    const chunk = serialized.includes("长回答") ? 256 : 16;
    for (let i = 0; i < answer.length; i += chunk) {
      await this.wait(r.signal);
      if (r.signal.aborted) throw new AppError("E_CANCELLED", "生成已停止");
      yield { type: "text", text: answer.slice(i, i + chunk) };
    }
    yield {
      type: "usage",
      usage: { input: 100, cached: 0, output: answer.length },
    };
  }
}
