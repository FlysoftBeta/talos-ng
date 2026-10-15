export interface ObjectInfo {
  id: string;
  size: number;
}
export interface ByteRange {
  start: number;
  end: number;
}
export interface RandomAccess {
  readonly size: number;
  read(offset: number, len: number): Promise<Uint8Array>;
  close(): Promise<void>;
}
export interface Stage {
  readonly size: number;
  append(chunk: Uint8Array, atOffset: number): Promise<number>;
  commit(expect?: Partial<ObjectInfo>): Promise<ObjectInfo>;
  abort(): Promise<void>;
}
export type ObjectStat = ObjectInfo & { mtimeMs: number };
/** Objects are readable immediately, but must not be referenced durably until commit.
 * An interrupted batch may leave orphan files; replay validates and repairs them.
 * Callers must exclude deletion/GC for the lifetime of a batch. */
export interface ObjectBatch {
  put: ObjectStore["put"];
  commit(): Promise<void>;
}
export interface ObjectStore {
  beginBulk?(): ObjectBatch;
  put(
    src: Uint8Array | AsyncIterable<Uint8Array>,
    expect?: Partial<ObjectInfo>,
  ): Promise<ObjectInfo>;
  stage(stageId: string): Promise<Stage>;
  has(id: string): Promise<boolean>;
  stat(id: string): Promise<ObjectStat | null>;
  read(id: string, range?: ByteRange): AsyncIterable<Uint8Array>;
  readAll(id: string, range?: ByteRange): Promise<Uint8Array>;
  open(id: string): Promise<RandomAccess>;
  localPath(id: string): string | null;
  delete(id: string): Promise<boolean>;
  list(): AsyncIterable<ObjectStat>;
  verify(id: string): Promise<boolean>;
  sweepStages(olderThanMs: number): Promise<number>;
  sweepTrash?(): Promise<number>;
  usage?(): Promise<{ objects: number; bytes: number }>;
}
export interface ManagedObjectStore extends ObjectStore {
  sweepTrash(): Promise<number>;
  usage(): Promise<{ objects: number; bytes: number }>;
}
export interface StoreOptions {
  clock?: () => number;
}
