import { AppError, utf8Encode } from "@talos/base";
import type { AiConversation, AiMessage, ArgsOf, ai } from "@talos/contract";
import type { JobContext } from "../../../kernel/jobs/jobs.ts";
import type { WriteContext } from "../../../kernel/persistence/uow.ts";
import type { Billing } from "../billing/service.ts";
import type { AiOptions } from "../options.ts";
import type { ToolCall } from "../providers/responses.ts";
import { usageCost } from "../providers/responses.ts";
import type { AiRepo } from "../repo.ts";
import type { Workspace } from "../workspace/service.ts";
import { fileTools } from "../workspace/service.ts";
export interface RunsContext {
  repo: Pick<
    AiRepo,
    | "active"
    | "text"
    | "file"
    | "messages"
    | "putMessage"
    | "insertRun"
    | "run"
    | "message"
    | "finishRun"
  >;
  options: Pick<AiOptions, "jobs" | "provider" | "uow" | "now" | "allowed">;
  requireConversation(user: string, id: string): AiConversation;
  billing: Pick<Billing, "reserve" | "project" | "settle">;
  id: () => string;
  putConversation(user: string, c: AiConversation, ctx: WriteContext): void;
  closed: boolean;
  workspace: Pick<Workspace, "tool">;
}
export class Runs {
  constructor(private readonly context: RunsContext) {}
  jobsChanged(ids: readonly string[]): void {
    for (const r of this.context.repo.active()) {
      if (!ids.includes(r.job)) continue;
      const job = this.context.options.jobs.get(r.job);
      if (job?.state === "cancelled" || job?.state === "failed")
        this.finish(r.id, job.state, r.charged, job.error?.message ?? null);
    }
  }
  start(user: string, args: ArgsOf<typeof ai.run.start>): { id: string } {
    if (args.textId) {
      const staged = this.context.repo.text(user, args.textId);
      if (!staged || staged.total !== staged.content.length)
        throw new AppError("E_CONFLICT", "消息尚未上传完整");
      args = { ...args, text: staged.content };
    }
    if (args.text.length > 100000)
      throw new AppError("E_TOO_LARGE", "消息最多 100000 字符");
    if (!args.text.trim()) throw new AppError("E_INVALID", "请输入文字");
    const provider = this.context.options.provider;
    if (!provider) throw new AppError("E_UNAVAILABLE", "AI 尚未配置");
    return this.context.options.uow.write((ctx) => {
      const c = this.context.requireConversation(user, args.conversation);
      if (c.running) throw new AppError("E_BUSY", "当前对话正在生成");
      if (this.context.repo.active(user).length >= 2)
        throw new AppError("E_BUSY", "最多同时生成两个回答，请稍后重试");
      const images = (args.images ?? []).map((path) => {
        const f = this.context.repo.file(user, path);
        if (!f || !f.mime.startsWith("image/") || f.mime === "image/svg+xml")
          throw new AppError("E_INVALID", "图片附件不存在");
        return {
          path,
          mime: f.mime as AiMessage["images"][number]["mime"],
          size: f.bytes.length,
        };
      });
      const model = provider.models[0]!;
      const context = this.context.repo.messages(c.id, undefined, 100000);
      const inputBytes = context.reduce(
        (n, m) => n + utf8Encode(m.text).length,
        utf8Encode(args.text).length,
      );
      const imageBytes = context.reduce(
        (sum, m) => sum + m.images.reduce((n, i) => n + i.size, 0),
        images.reduce((n, i) => n + i.size, 0),
      );
      if (inputBytes > 512 * 1024 || imageBytes > 20 * 1024 * 1024)
        throw new AppError("E_TOO_LARGE", "上下文过长，请新建对话并概述前文");
      const reserved = Math.max(
        1000000,
        Math.ceil(
          (inputBytes + images.length * 10000 + 800000) * model.inputPrice * 9 +
            model.maxOutput * model.outputPrice * 9,
        ),
      );
      const allocation = this.context.billing.reserve(user, reserved);
      const id = this.context.id(),
        job = this.context.options.jobs.enqueue(user, "ai.run", { run: id });
      const input: AiMessage = {
        id: this.context.id(),
        conversation: c.id,
        seq: c.lastSeq + 1,
        rev: ctx.rev,
        role: "user",
        text: args.text,
        images,
        status: "done",
        created: this.context.options.now(),
        error: null,
      };
      const output: AiMessage = {
        ...input,
        id: this.context.id(),
        seq: input.seq + 1,
        role: "assistant",
        text: "",
        images: [],
        status: "queued",
      };
      this.context.repo.putMessage(user, input);
      this.context.repo.putMessage(user, output);
      this.context.repo.insertRun({
        id,
        user,
        conversation: c.id,
        message: output.id,
        job: job.id,
        state: "queued",
        reserved,
        charged: 0,
        ...allocation,
        created: this.context.options.now(),
      });
      this.context.putConversation(
        user,
        {
          ...c,
          lastSeq: output.seq,
          running: id,
          updated: this.context.options.now(),
        },
        ctx,
      );
      ctx.changed(`ai:${c.id}`, "aiMessage", input.id);
      ctx.changed(`ai:${c.id}`, "aiMessage", output.id);
      this.context.billing.project(user, ctx);
      return { id };
    });
  }
  stop(user: string, id: string): { ok: true } {
    const r = this.context.repo.run(id);
    if (!r || r.user !== user)
      throw new AppError("E_NOT_FOUND", "生成任务不存在");
    this.context.options.uow.write(() => {
      this.finish(id, "cancelled", r.charged, null);
      this.context.options.jobs.cancel(user, r.job);
    });
    return { ok: true };
  }
  finish(
    id: string,
    state: "done" | "failed" | "cancelled",
    charged: number,
    error: string | null,
  ): void {
    this.context.options.uow.write((ctx) => {
      const r = this.context.repo.run(id);
      if (!r || !["queued", "running"].includes(r.state)) return;
      const m = this.context.repo.message(r.message)!;
      this.context.repo.putMessage(r.user, {
        ...m,
        status: state,
        error,
        rev: ctx.rev,
      });
      const c = this.context.requireConversation(r.user, r.conversation);
      this.context.putConversation(
        r.user,
        { ...c, running: null, updated: this.context.options.now() },
        ctx,
      );
      this.context.billing.settle(r, state, charged, ctx);
      ctx.changed(`ai:${r.conversation}`, "aiMessage", m.id);
    });
  }
  async execute(ctx: JobContext): Promise<void> {
    const id = (ctx.payload as { run: string }).run;
    let r = this.context.repo.run(id);
    if (!r || !["queued", "running"].includes(r.state)) return;
    const provider = this.context.options.provider;
    if (!provider) {
      this.finish(id, "failed", 0, "AI 尚未配置");
      throw new AppError("E_UNAVAILABLE", "AI 尚未配置");
    }
    const controller = new AbortController(),
      abort = () => controller.abort();
    ctx.signal.addEventListener("abort", abort);
    let charged = r.charged,
      text = this.context.repo.message(r.message)!.text,
      last = 0,
      lastTime = 0;
    const checkpoint = (): void => {
      if (this.context.closed) return;
      this.context.options.uow.write((write) => {
        r = this.context.repo.run(id)!;
        if (!["queued", "running"].includes(r.state)) return;
        const m = this.context.repo.message(r.message)!;
        this.context.repo.putMessage(r.user, {
          ...m,
          text,
          status: "running",
          rev: write.rev,
        });
        this.context.repo.finishRun(
          id,
          "running",
          Math.min(charged, r.reserved),
        );
        write.changed(`ai:${r.conversation}`, "aiMessage", m.id);
      });
      last = text.length;
      lastTime = this.context.options.now();
    };
    try {
      if (ctx.signal.aborted) abort();
      checkpoint();
      const model = provider.models[0]!,
        items: Record<string, unknown>[] = this.context.repo
          .messages(r.conversation, undefined, 100000)
          .filter((m) => m.id !== r!.message)
          .map((m) => ({
            role: m.role,
            content: [
              {
                type: m.role === "user" ? "input_text" : "output_text",
                text: m.text,
              },
              ...m.images.map((i) => {
                const f = this.context.repo.file(r!.user, i.path);
                if (!f) throw new AppError("E_NOT_FOUND", "历史图片缺失");
                return {
                  type: "input_image",
                  image_url: `data:${i.mime};base64,${Buffer.from(f.bytes).toString("base64")}`,
                };
              }),
            ],
          }));
      for (let round = 0; round < 9; round++) {
        if (
          this.context.options.allowed &&
          !this.context.options.allowed(r.user)
        )
          throw new AppError("E_DENIED", "AI 权限已撤销");
        const calls: ToolCall[] = [];
        let hasUsage = false;
        let roundCost = 0,
          estimated = 0;
        for await (const event of provider.stream({
          user: r.user,
          model,
          items,
          tools: round < 8 ? fileTools : [],
          signal: controller.signal,
        })) {
          if (
            controller.signal.aborted ||
            this.context.repo.run(id)?.state === "cancelled"
          )
            throw new AppError("E_CANCELLED", "生成已停止");
          if (event.type === "text") {
            text += event.text;
            estimated += utf8Encode(event.text).length * model.outputPrice;
            if (text.length > 100000) {
              // The failure checkpoint must not persist more than the stored-answer limit.
              text = text.slice(0, 100000).replace(/[\ud800-\udbff]$/, "");
              throw new AppError("E_TOO_LARGE", "回答长度超过上限");
            }
            charged += utf8Encode(event.text).length * model.outputPrice;
            if (
              text.length - last >= 512 ||
              this.context.options.now() - lastTime >= 250
            )
              checkpoint();
          } else if (event.type === "usage") {
            roundCost = usageCost(model, event.usage);
            hasUsage = true;
          } else calls.push(event.call);
        }
        charged =
          Math.max(0, charged - estimated) + (hasUsage ? roundCost : estimated);
        checkpoint();
        if (!calls.length) break;
        if (round === 8)
          throw new AppError("E_TOO_LARGE", "文件工具调用次数超过上限");
        for (const call of calls) {
          if (controller.signal.aborted)
            throw new AppError("E_CANCELLED", "生成已停止");
          const result = this.context.workspace.tool(r.user, id, call);
          items.push(
            {
              type: "function_call",
              call_id: call.id,
              name: call.name,
              arguments: call.arguments,
            },
            {
              type: "function_call_output",
              call_id: call.id,
              output: JSON.stringify(result),
            },
          );
        }
      }
      this.finish(id, "done", charged, null);
    } catch (e) {
      if (!this.context.closed) {
        checkpoint();
        const failure =
          e instanceof AppError
            ? e
            : new AppError("E_UNAVAILABLE", "AI 生成失败，请重试");
        this.finish(
          id,
          controller.signal.aborted ? "cancelled" : "failed",
          charged,
          failure.message,
        );
        throw failure;
      }
    } finally {
      ctx.signal.removeEventListener("abort", abort);
    }
  }
}
