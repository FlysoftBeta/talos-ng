import { AppError } from "@talos/base";
import type { CancellationSignal } from "@talos/base";
import type { ArgsOf, Method, ResultOf } from "./protocol/definitions.ts";
import { methods } from "./registry.ts";
export interface CallOptions {
  body?: Uint8Array;
  op?: string;
  timeoutMs?: number;
  signal?: CancellationSignal;
}
export type Call = (
  method: string,
  args: unknown,
  options?: CallOptions,
) => Promise<{ data: unknown; body: Uint8Array }>;
type MethodCall<M extends Method> = (
  args: ArgsOf<M>,
  options?: CallOptions,
) => Promise<ResultOf<M>>;
type MethodPath<N extends string, F> = N extends `${infer Head}.${infer Tail}`
  ? { [K in Head]: MethodPath<Tail, F> }
  : { [K in N]: F };
type MethodTree<M> = M extends Method
  ? MethodPath<M["name"], MethodCall<M>>
  : never;
type Intersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;
export type Api = Intersection<MethodTree<(typeof methods)[number]>>;
/** Binds the finite registry, so it never creates accidental thenable/prototype methods. */
export function createApi(call: Call): Api {
  const root: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const method of methods) {
    const path = method.name.split(".");
    let node = root;
    for (const part of path.slice(0, -1)) {
      if (!node[part])
        node[part] = Object.create(null) as Record<string, unknown>;
      node = node[part] as Record<string, unknown>;
    }
    const leaf = path[path.length - 1];
    if (leaf !== undefined)
      node[leaf] = async (
        args: unknown,
        options?: CallOptions,
      ): Promise<unknown> => {
        const parsed = method.args.safeParse(args);
        if (!parsed.success) throw new AppError("E_INVALID", "调用参数无效");
        const reply = await call(method.name, parsed.data, options);
        const result = method.result.safeParse(reply.data);
        if (!result.success) throw new AppError("E_PROTOCOL", "服务器响应无效");
        return result.data;
      };
  }
  return root as Api;
}
