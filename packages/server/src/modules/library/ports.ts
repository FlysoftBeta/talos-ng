import type { CancellationSignal } from "@talos/base";
/** Publishes generated text; commit runs synchronously inside the library publication UoW. */
export interface LibraryPublication {
  importGeneratedText(
    user: string,
    input: { title: string; body: string; collection: string },
    commit: (doc: string) => void,
    signal: CancellationSignal,
  ): Promise<{ doc: string }>;
}
