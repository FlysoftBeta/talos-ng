import type { z } from "zod";

export interface Method<
  N extends string = string,
  A extends z.ZodType = z.ZodType,
  R extends z.ZodType = z.ZodType,
> {
  readonly name: N;
  readonly args: A;
  readonly result: R;
  readonly auth: "public" | "device" | "user";
  readonly offline: "queue" | "online";
  readonly body?: "in" | "out";
}
export function defineMethod<
  N extends string,
  A extends z.ZodType,
  R extends z.ZodType,
>(method: Method<N, A, R>): Readonly<Method<N, A, R>> {
  return Object.freeze(method);
}
export function defineEvent<N extends string, D extends z.ZodType>(event: {
  readonly topic: N;
  readonly data: D;
}): Readonly<typeof event> {
  return Object.freeze(event);
}
export function defineEntity<N extends string, S extends z.ZodType>(entity: {
  readonly name: N;
  readonly schema: S;
  readonly windowed?: boolean;
}): Readonly<typeof entity> {
  return Object.freeze(entity);
}
export type ArgsOf<M extends Method> = z.input<M["args"]>;
export type ResultOf<M extends Method> = z.output<M["result"]>;
