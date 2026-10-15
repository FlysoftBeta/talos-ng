import { mkdtemp, writeFile, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { deferred } from "@talos/base";
import {
  PdfRenderRunner,
  removeTemp,
  FileAccess,
  PdfRenderArchive,
} from "../index.ts";
import type { RunnerTimer } from "../index.ts";
let dir: string;
let script: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "runner-test-"));
  script = path.join(dir, "fake.mjs");
});
afterEach(async () => removeTemp(dir));
function runner(timer?: RunnerTimer, concurrency = 1, cpus = 8) {
  return new PdfRenderRunner({
    location: {
      executable: process.execPath,
      env: process.env,
      platform: process.platform,
    },
    prefixArgs: [script],
    timer,
    concurrency,
    cpus,
    timeoutMs: 1234,
  });
}
const signal = () => new AbortController().signal;
const tmp = () => path.join(dir, "jobs");
it("uses exact arguments, clamps jobs, no shell, temp cwd, and cleans successful outputs", async () => {
  await writeFile(
    script,
    "import {writeFileSync} from 'node:fs'; writeFileSync(process.argv.at(-1),JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));",
  );
  for (const [cpus, jobs] of [
    [1, 1],
    [3, 2],
    [128, 4],
  ]) {
    await runner(undefined, 1, cpus).run(
      "a file;$(ignored).pdf",
      tmp(),
      signal(),
      async (output) => {
        const value = JSON.parse(await readFile(output, "utf8"));
        expect(value.args).toEqual([
          "--resolution",
          "96",
          "--webp-quality",
          "80",
          "--jobs",
          String(jobs),
          path.resolve("a file;$(ignored).pdf"),
          output,
        ]);
        expect(value.cwd).toBe(path.dirname(output));
      },
    );
    expect(await readdir(tmp())).toEqual([]);
  }
});
it("queued cancellation never starts a timer/process; running cancellation kills and releases the permit", async () => {
  await writeFile(script, "setInterval(()=>{},1000);");
  const started = deferred<void>();
  let count = 0,
    cleared = 0;
  const timer: RunnerTimer = {
    set: () => {
      count++;
      started.resolve();
      return 1;
    },
    clear: () => {
      cleared++;
    },
  };
  const r = runner(timer);
  const first = new AbortController(),
    second = new AbortController();
  const p = r.run("in.pdf", tmp(), first.signal, async () => undefined);
  const rejected = expect(p).rejects.toMatchObject({ code: "E_CANCELLED" });
  await started.promise;
  const q = r.run("in.pdf", tmp(), second.signal, async () => undefined);
  const queued = expect(q).rejects.toMatchObject({ code: "E_CANCELLED" });
  second.abort();
  await queued;
  expect(count).toBe(1);
  first.abort();
  await rejected;
  expect(cleared).toBe(1);
  expect(await readdir(tmp())).toEqual([]);
  await writeFile(script, "");
  await r.run("in.pdf", tmp(), signal(), async () => undefined);
  expect(count).toBe(2);
});
it("timeout begins only after spawn and is deterministic through injected timer", async () => {
  await writeFile(script, "setInterval(()=>{},1000);");
  const started = deferred<void>();
  let fire: () => void = () => {};
  let cleared = false;
  const timer: RunnerTimer = {
    set: (cb, ms) => {
      expect(ms).toBe(1234);
      fire = cb;
      started.resolve();
      return 1;
    },
    clear: () => {
      cleared = true;
    },
  };
  const pending = runner(timer).run(
    "in.pdf",
    tmp(),
    signal(),
    async () => undefined,
  );
  const assertion = expect(pending).rejects.toMatchObject({
    code: "E_TIMEOUT",
  });
  await started.promise;
  fire();
  await assertion;
  expect(cleared).toBe(true);
  expect(await readdir(tmp())).toEqual([]);
});
it("waiters execute in FIFO order, excluding cancelled waiters", async () => {
  await writeFile(script, "");
  const r = runner();
  const entered = deferred<void>(),
    release = deferred<void>();
  const order: number[] = [];
  const first = r.run("a", tmp(), signal(), async () => {
    order.push(1);
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const second = r.run("b", tmp(), signal(), async () => {
    order.push(2);
  });
  const third = r.run("c", tmp(), signal(), async () => {
    order.push(3);
  });
  release.resolve();
  await Promise.all([first, second, third]);
  expect(order).toEqual([1, 2, 3]);
});
it.each([
  {
    code: 1,
    message: "文档已加密，暂不支持",
    stderr: "Incorrect password",
    error: "E_INVALID",
  },
  {
    code: 1,
    message: "文档无效、已加密或没有页面",
    stderr: "bad PDF",
    error: "E_INVALID",
  },
  { code: 2, message: "文档渲染失败", stderr: "usage", error: "E_INTERNAL" },
  { code: 3, message: "文档渲染失败", stderr: "crash", error: "E_INVALID" },
])(
  "maps native exit $code with diagnostic tail",
  async ({ code, message, stderr, error }) => {
    await writeFile(
      script,
      `import {writeSync} from 'node:fs'; writeSync(2,'x'.repeat(70000)+${JSON.stringify(stderr)});process.exit(${code});`,
    );
    try {
      await runner().run("in.pdf", tmp(), signal(), async () => undefined);
      throw new Error("unexpected success");
    } catch (e) {
      expect(e).toMatchObject({ code: error, message });
      const data = (e as { data: { stderr: string } }).data;
      expect(Buffer.byteLength(data.stderr)).toBeLessThanOrEqual(65536);
      expect(data.stderr.endsWith(stderr)).toBe(true);
    }
    expect(await readdir(tmp())).toEqual([]);
  },
);
it.each([0, 3])("cleans garbage archive on exit %s", async (exit) => {
  await writeFile(
    script,
    `import {writeFileSync} from 'node:fs';writeFileSync(process.argv.at(-1),'garbage');process.exit(${exit});`,
  );
  await expect(
    runner().run("in.pdf", tmp(), signal(), async (output) => {
      const f = await FileAccess.open(output);
      try {
        await PdfRenderArchive.open(f);
      } finally {
        await f.close();
      }
    }),
  ).rejects.toMatchObject({ code: exit === 0 ? "E_INTEGRITY" : "E_INVALID" });
  expect(await readdir(tmp())).toEqual([]);
});
it("launch failure and consumer failure clean temporary directories", async () => {
  const r = new PdfRenderRunner({
    location: {
      executable: path.join(dir, "missing"),
      env: {},
      platform: process.platform,
    },
  });
  await expect(
    r.run("in", tmp(), signal(), async () => {}),
  ).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
  expect(await readdir(tmp())).toEqual([]);
  await writeFile(script, "");
  await expect(
    runner().run("in", tmp(), signal(), async () => {
      throw new Error("consumer");
    }),
  ).rejects.toThrow("consumer");
  expect(await readdir(tmp())).toEqual([]);
});

it("resolves a relative temporary directory before changing the renderer cwd", async () => {
  await writeFile(
    script,
    "import {writeFileSync} from 'node:fs';writeFileSync(process.argv.at(-1),'ok');",
  );
  await runner().run(
    "in.pdf",
    path.relative(process.cwd(), tmp()),
    signal(),
    async (output) => {
      expect(path.isAbsolute(output)).toBe(true);
      expect(await readFile(output, "utf8")).toBe("ok");
    },
  );
  expect(await readdir(tmp())).toEqual([]);
});
