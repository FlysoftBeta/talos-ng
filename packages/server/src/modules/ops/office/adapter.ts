import { AppError } from "@talos/base";
import { retry } from "@talos/launcher";
import { readFile, stat } from "node:fs/promises";
import { win32 } from "node:path";
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
type Kind = CapturedFile["kind"];
/** Source keys the script prints; `wps` is the unified WPS window of any kind. */
const SOURCES = new Map<string, { application: string; kind?: Kind }>([
  ["ms-word", { application: "Microsoft Word", kind: "word" }],
  ["wps-word", { application: "WPS 文字", kind: "word" }],
  [
    "ms-powerpoint",
    { application: "Microsoft PowerPoint", kind: "powerpoint" },
  ],
  ["wps-powerpoint", { application: "WPS 演示", kind: "powerpoint" }],
  ["ms-excel", { application: "Microsoft Excel", kind: "excel" }],
  ["wps-excel", { application: "WPS 表格", kind: "excel" }],
  ["wps", { application: "WPS Office" }],
]);
const EXTENSIONS: Record<Kind, readonly string[]> = {
  word: ["doc", "docx", "docm", "dot", "dotx", "dotm", "rtf", "wps", "wpt"],
  powerpoint: [
    ...["ppt", "pptx", "pptm", "pps", "ppsx", "ppsm"],
    ...["pot", "potx", "potm", "dps", "dpt"],
  ],
  excel: [
    ...["xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "xltm"],
    ...["et", "ett", "csv"],
  ],
};
function kindOf(path: string): Kind | undefined {
  const extension = win32.extname(path).slice(1).toLowerCase();
  return (Object.keys(EXTENSIONS) as Kind[]).find((kind) =>
    EXTENSIONS[kind].includes(extension),
  );
}
/**
 * Windows PowerShell 2.0+ (no `::new`, no ConvertTo-Json). Prints one
 * `source<TAB>base64(UTF-8 path)` line per open document (`cmd:` marks a
 * command-line source), so the console code
 * page cannot garble names. Two sources: the documents of running Office/WPS
 * automation objects, and document paths on the command lines of their
 * processes. The second covers an application that has not registered for
 * automation yet (Office registers only after its window first loses focus)
 * or that runs in another session.
 */
const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
function Emit($source, $path) {
 if ([string]$path) { [Console]::Out.WriteLine($source + [char]9 + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$path))) }
}
$targets = @(
 @('Word.Application','Documents','ms-word'),
 @('KWPS.Application','Documents','wps-word'),
 @('PowerPoint.Application','Presentations','ms-powerpoint'),
 @('KWPP.Application','Presentations','wps-powerpoint'),
 @('Excel.Application','Workbooks','ms-excel'),
 @('KET.Application','Workbooks','wps-excel'))
foreach ($t in $targets) {
 try {
  $app = [Runtime.InteropServices.Marshal]::GetActiveObject($t[0])
  $items = $app.($t[1])
  for ($i = 1; $i -le $items.Count; $i++) {
   try { $d = $items.Item($i); if ([string]$d.Path) { Emit $t[2] $d.FullName } } catch {}
  }
 } catch {}
}
$images = @{ 'winword.exe'='ms-word'; 'powerpnt.exe'='ms-powerpoint'; 'excel.exe'='ms-excel'; 'wps.exe'='wps-word'; 'wpp.exe'='wps-powerpoint'; 'et.exe'='wps-excel'; 'wpsoffice.exe'='wps' }
try {
 $filter = ($images.Keys | ForEach-Object { "Name='" + $_ + "'" }) -join ' OR '
 foreach ($p in @(Get-WmiObject Win32_Process -Filter $filter)) {
  $source = $images[([string]$p.Name).ToLower()]
  foreach ($m in [regex]::Matches([string]$p.CommandLine, '"([^"]+)"|(\S+)')) {
   $arg = $m.Groups[1].Value
   if (-not $arg) { $arg = $m.Groups[2].Value }
   if ($arg -match '^[A-Za-z]:\\|^\\\\' -and (Test-Path -LiteralPath $arg -PathType Leaf)) { Emit ('cmd:' + $source) $arg }
  }
 }
} catch {}
`;
const MAX_FILE = 100 * 1024 * 1024,
  MAX_TOTAL = 256 * 1024 * 1024;
/** Documents named by the script's lines; malformed lines and other file types are ignored. */
export function parseOpenDocuments(
  text: string,
): { path: string; application: string; kind: Kind }[] {
  const out: { path: string; application: string; kind: Kind }[] = [],
    seen = new Set<string>();
  for (const line of text.split(/\r?\n/).slice(0, 1000)) {
    const [key = "", encoded] = line.trim().split("\t");
    const commandLine = key.startsWith("cmd:");
    const source = SOURCES.get(commandLine ? key.slice(4) : key);
    if (!source || !encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
      continue;
    const path = Buffer.from(encoded, "base64").toString("utf8");
    // Automation reports what the application has open whatever its name; a
    // command-line argument counts only with a document extension.
    const kind = commandLine ? kindOf(path) : (source.kind ?? kindOf(path));
    if (!kind || !win32.isAbsolute(path) || seen.has(path.toLowerCase()))
      continue;
    seen.add(path.toLowerCase());
    out.push({ path, application: source.application, kind });
  }
  return out;
}
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
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ]);
      const files: CapturedFile[] = [];
      let total = 0;
      // One unreadable document (locked, too large, changing while copied) is
      // skipped for this round; it never hides the others.
      for (const document of parseOpenDocuments(text)) {
        try {
          const before = await retry(() => stat(document.path));
          if (!before.isFile() || before.size > MAX_FILE) continue;
          if (total + before.size > MAX_TOTAL) continue;
          const bytes = await retry(() => readFile(document.path)),
            after = await retry(() => stat(document.path));
          if (
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            bytes.length !== after.size
          )
            continue;
          total += bytes.length;
          files.push({
            name: win32.basename(document.path),
            application: document.application,
            kind: document.kind,
            bytes,
          });
        } catch {
          continue;
        }
      }
      return files;
    },
  };
}
