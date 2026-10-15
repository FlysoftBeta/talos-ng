const cases: { name: string; run: () => Promise<void> }[] = [];
export function test(name: string, run: () => Promise<void>): void {
  cases.push({ name, run });
}
export async function run(): Promise<{ passed: number; failed: string[] }> {
  const failed: string[] = [];
  let passed = 0;
  for (const entry of cases) {
    try {
      await entry.run();
      passed++;
    } catch (error) {
      failed.push(
        `${entry.name}: ${error instanceof Error ? error.stack : String(error)}`,
      );
    }
  }
  return { passed, failed };
}
