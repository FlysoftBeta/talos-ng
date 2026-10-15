import { AppError } from "@talos/base";
import { retry } from "@talos/launcher";
import { readFile, stat } from "node:fs/promises";
import type { RunCommand } from "../host/adapter.ts";
import { runCommand } from "../host/adapter.ts";
export interface CapturedFile {
  name: string;
  application: string;
  kind: "word" | "powerpoint" | "excel";
  bytes: Uint8Array;
}
export interface OfficeCapture {
  readonly available: boolean;
  capture(): Promise<readonly CapturedFile[]>;
}
const script = String.raw`
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$targets = @(
@{app="Microsoft Word";id="Word.Application";kind="word";items="Documents"},
@{app="WPS 文字";id="KWPS.Application";kind="word";items="Documents"},
@{app="Microsoft PowerPoint";id="PowerPoint.Application";kind="powerpoint";items="Presentations"},
@{app="WPS 演示";id="KWPP.Application";kind="powerpoint";items="Presentations"},
@{app="Microsoft Excel";id="Excel.Application";kind="excel";items="Workbooks"},
@{app="WPS 表格";id="KET.Application";kind="excel";items="Workbooks"})
$result=@()
foreach($target in $targets) {
 try { $app=[Runtime.InteropServices.Marshal]::GetActiveObject($target.id)
 $items=$app.($target.items)
 for($i=1;$i -le $items.Count;$i++) {try {$d=$items.Item($i);if([string]$d.Path){$result+=@{name=[string]$d.Name;path=[string]$d.FullName;application=$target.app;kind=$target.kind}}}catch{}}
 } catch{}
}
ConvertTo-Json -InputObject @($result) -Compress
`;
export function createOfficeCapture(
  platform: NodeJS.Platform = process.platform,
  run: RunCommand = runCommand,
): OfficeCapture {
  return {
    available: platform === "win32",
    async capture() {
      if (platform !== "win32")
        throw new AppError("E_UNAVAILABLE", "文档捕获仅支持 Windows");
      const text = await run("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ]);
      let input: unknown;
      try {
        input = JSON.parse(text.replace(/^\uFEFF/, ""));
      } catch {
        throw new AppError("E_UNAVAILABLE", "无法读取 Office 文档列表");
      }
      if (!Array.isArray(input) || input.length > 1000)
        throw new AppError("E_TOO_LARGE", "Office 文档列表无效");
      const files: CapturedFile[] = [],
        seen = new Set<string>();
      let total = 0;
      for (const value of input as unknown[]) {
        if (!value || typeof value !== "object")
          throw new AppError("E_INVALID", "Office 文档信息无效");
        const d = value as Record<string, unknown>;
        if (
          typeof d.path !== "string" ||
          typeof d.name !== "string" ||
          typeof d.application !== "string" ||
          !["word", "powerpoint", "excel"].includes(String(d.kind))
        )
          throw new AppError("E_INVALID", "Office 文档信息无效");
        const key = d.path.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const before = await retry(() => stat(d.path as string));
        if (!before.isFile() || before.size > 100 * 1024 * 1024)
          throw new AppError("E_TOO_LARGE", "文档过大或不是文件");
        total += before.size;
        if (total > 256 * 1024 * 1024)
          throw new AppError("E_TOO_LARGE", "捕获文档总量超过 256 MiB");
        const bytes = await retry(() => readFile(d.path as string)),
          after = await retry(() => stat(d.path as string));
        if (
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          bytes.length !== after.size
        )
          throw new AppError("E_CONFLICT", "源文档在复制期间变化，请重试");
        files.push({
          name: d.name,
          application: d.application,
          kind: d.kind as CapturedFile["kind"],
          bytes,
        });
      }
      return files;
    },
  };
}
