export async function retry<T>(
  fn: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let i = 0; ; i++)
    try {
      return await fn();
    } catch (error) {
      if (
        i >= 5 ||
        !["EBUSY", "EPERM", "EACCES"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
      await wait(10 * 2 ** i);
    }
}
