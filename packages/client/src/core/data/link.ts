import { AppError } from "@talos/base";
import type {
  ArgsOf,
  CallOptions,
  contract,
  Method,
  ResultOf,
} from "@talos/contract";
import { events } from "@talos/contract";
import type { LinkClient } from "@talos/link";

export interface TypedCall {
  <M extends Method>(
    method: M,
    args: ArgsOf<M>,
    options?: CallOptions,
  ): Promise<ResultOf<M>>;
}
export function typedCall(link: Pick<LinkClient, "call">): TypedCall {
  return async (method, args, options) => {
    const parsed = method.args.safeParse(args);
    if (!parsed.success) throw new AppError("E_INVALID", "调用参数无效");
    const reply = await link.call(method.name, parsed.data, options);
    const result = method.result.safeParse(reply.data);
    if (!result.success) throw new AppError("E_PROTOCOL", "服务器响应无效");
    return result.data as ResultOf<typeof method>;
  };
}
export function subscribeDelta(
  link: Pick<LinkClient, "on">,
  listener: (data: ResultOf<typeof contract.sync.pull>) => void,
  onError: (error: AppError) => void,
): () => void {
  return link.on("sync.delta", (event) => {
    const parsed = events["sync.delta"].data.safeParse(event.data);
    if (parsed.success) listener(parsed.data);
    else onError(new AppError("E_PROTOCOL", "同步数据无效"));
  });
}
