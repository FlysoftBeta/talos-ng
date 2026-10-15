import { nativeFiles } from "./native.ts";
import { tarGz } from "./tar.ts";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { gunzipSync } from "node:zlib";
import {
  digest,
  readZip,
  writeZip,
  buildId,
  packageTargets,
  parseTarget,
} from "@talos/launcher";
import type { ReleaseManifest } from "@talos/launcher";
const root = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.length && (args.length !== 2 || args[0] !== "--target"))
  throw new Error("Usage: pnpm package -- --target <id>");
const requestedTarget = args[1] ?? process.env.TALOS_PACKAGE_TARGET;
const selectedTarget = requestedTarget
  ? parseTarget(requestedTarget)
  : undefined;
const nodeVersion = "v22.23.3";
const clientManifest = JSON.parse(
  await readFile(join(root, "packages/client/dist/app/manifest.json"), "utf8"),
) as { build: string; assets: { path: string }[] };
const build = buildId(clientManifest.build);
const mediaManifest = JSON.parse(
  await readFile(join(root, "tools/package/media-manifest.json"), "utf8"),
) as {
  version: string;
  linux: { url: string; sha256: string };
  windows: { url: string; sha256: string };
};
const cache =
  process.env.TALOS_RUNTIME_CACHE ??
  join(homedir(), ".cache", "talos-ng", "node");
await mkdir(cache, { recursive: true });
const sums = await fetch(
  `https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`,
).then(async (r) => {
  if (!r.ok) throw new Error("Node checksum download failed");
  return r.text();
});
async function runtime(platform: string): Promise<Map<string, Uint8Array>> {
  const name = `node-${nodeVersion}-${platform === "win32-x64" ? "win-x64.zip" : "linux-x64.tar.gz"}`;
  const sha = sums
    .split("\n")
    .find((line) => line.endsWith("  " + name))
    ?.split(" ")[0];
  if (!sha) throw new Error("Official Node checksum missing");
  const path = join(cache, name);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    bytes = Buffer.alloc(0);
  }
  if (digest(bytes) !== sha) {
    const response = await fetch(
      `https://nodejs.org/dist/${nodeVersion}/${name}`,
    );
    if (!response.ok) throw new Error("Node download failed");
    bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== sha) throw new Error("Node SHA-256 mismatch");
    await writeFile(path, bytes);
  }
  const result = new Map<string, Uint8Array>();
  if (platform === "win32-x64") {
    const zip = readZip(bytes);
    for (const [name, data] of zip)
      if (name.endsWith("/node.exe") || name.endsWith("/LICENSE"))
        result.set(
          name.endsWith("node.exe") ? "runtime/node.exe" : "runtime/LICENSE",
          data,
        );
  } else {
    const tar = gunzipSync(bytes);
    for (let p = 0; p + 512 <= tar.length;) {
      const name = tar
        .subarray(p, p + 100)
        .toString()
        .replace(/\0.*$/s, "");
      if (!name) break;
      const size = parseInt(
        tar
          .subarray(p + 124, p + 136)
          .toString()
          .replace(/\0.*$/s, "")
          .trim(),
        8,
      );
      if (
        !Number.isSafeInteger(size) ||
        size < 0 ||
        p + 512 + size > tar.length
      )
        throw new Error("Invalid Node tar");
      if (name.endsWith("/bin/node") || name.endsWith("/LICENSE"))
        result.set(
          name.endsWith("/bin/node") ? "runtime/node" : "runtime/LICENSE",
          tar.subarray(p + 512, p + 512 + size),
        );
      p += 512 + Math.ceil(size / 512) * 512;
    }
  }
  if (
    !result.has(platform === "win32-x64" ? "runtime/node.exe" : "runtime/node")
  )
    throw new Error("Node executable missing");
  return result;
}
async function addTree(
  files: Map<string, Uint8Array>,
  directory: string,
  prefix: string,
): Promise<void> {
  for (const item of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (item.isSymbolicLink())
      throw new Error("Release cannot contain symbolic links");
    const path = join(directory, item.name),
      name = `${prefix}/${item.name}`;
    if (item.isDirectory()) await addTree(files, path, name);
    else files.set(name, await readFile(path));
  }
}
async function mediaBinary(
  platform: "linux-x64" | "win32-x64",
): Promise<Map<string, Uint8Array>> {
  const spec =
    platform === "win32-x64" ? mediaManifest.windows : mediaManifest.linux;
  const dir =
    process.env.TALOS_MEDIA_CACHE ??
    join(homedir(), ".cache", "talos-ng", "media");
  await mkdir(dir, { recursive: true });
  const path = join(
    dir,
    platform === "win32-x64"
      ? `yt-dlp-${mediaManifest.version}-win.zip`
      : `yt-dlp-${mediaManifest.version}-linux`,
  );
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    bytes = Buffer.alloc(0);
  }
  if (digest(bytes) !== spec.sha256) {
    const response = await fetch(spec.url);
    if (!response.ok)
      throw new Error(`yt-dlp download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== spec.sha256)
      throw new Error("yt-dlp SHA-256 mismatch");
    await writeFile(path, bytes);
  }
  if (platform === "linux-x64")
    return new Map([["vendor/media/yt-dlp", bytes]]);
  const zip = readZip(bytes);
  const result = new Map<string, Uint8Array>();
  for (const [name, data] of zip)
    if (name === "yt-dlp.exe" || name.startsWith("_internal/"))
      result.set(`vendor/media/${name}`, data);
  if (!result.has("vendor/media/yt-dlp.exe"))
    throw new Error("yt-dlp.exe missing");
  return result;
}
for (const platform of packageTargets) {
  if (selectedTarget && selectedTarget !== platform) continue;
  const payload = new Map<string, Uint8Array>();
  payload.set(
    "server.js",
    await readFile(join(root, "packages/server/dist/server.js")),
  );
  payload.set("package.json", Buffer.from('{"type":"module"}'));
  // Only this target's better-sqlite3/sharp binaries (never another platform's).
  for (const [name, data] of await nativeFiles(
    platform === "win32-x64" ? platform : "linux-x64",
  ))
    payload.set(name, data);
  await addTree(
    payload,
    join(root, "packages/server/dist/chat-assets"),
    "chat-assets",
  );
  // Ship exactly the installable shell; gallery and build diagnostics are dev-only.
  for (const name of [
    "index.html",
    "app/manifest.json",
    ...clientManifest.assets.map((asset) => asset.path.slice(1)),
  ])
    payload.set(
      `client/${name}`,
      await readFile(join(root, "packages/client/dist", name)),
    );
  await addTree(payload, join(root, "packages/shell/dist"), "shell");
  for (const [name, data] of await mediaBinary(
    platform === "win32-x64" ? platform : "linux-x64",
  ))
    payload.set(name, data);
  for (const flavor of platform === "win32-x64"
    ? ["windows"]
    : [platform.replace(/-x64$/, "")])
    await addTree(
      payload,
      join(root, "vendor/pdfrender", flavor),
      `vendor/pdfrender/${flavor}`,
    );
  payload.set(
    "vendor/pdfrender/README.md",
    await readFile(join(root, "vendor/pdfrender/README.md")),
  );
  for (const name of ["manifest.json", "FORMAT.md"])
    payload.set(
      `vendor/pdfrender/${name}`,
      await readFile(join(root, "vendor/pdfrender", name)),
    );
  payload.set("vendor/pdfrender/target", Buffer.from(platform + "\n"));
  const manifest: ReleaseManifest = {
    v: 1,
    build,
    platform,
    files: [...payload].map(([path, bytes]) => ({
      path,
      size: bytes.length,
      sha256: digest(bytes),
    })),
  };
  payload.set("release.json", Buffer.from(JSON.stringify(manifest)));
  const out = join(root, "dist/release");
  await mkdir(out, { recursive: true });
  const update = writeZip(payload);
  const updateName = `talos-${build}-${platform}-update.zip`;
  await writeFile(join(out, updateName), update);
  await writeFile(
    join(out, updateName + ".json"),
    JSON.stringify({
      v: 1,
      build,
      platform,
      url: updateName,
      size: update.length,
      sha256: digest(update),
    }),
  );
  const install = await runtime(platform);
  for (const [name, data] of payload)
    install.set(`releases/${build}/${name}`, data);
  install.set("target", Buffer.from(platform + "\n"));
  install.set("current", Buffer.from(build + "\n"));
  install.set("package.json", Buffer.from('{"type":"module"}'));
  install.set(
    "launcher.js",
    await readFile(join(root, "packages/launcher/dist/launcher.js")),
  );
  install.set(
    "talos.config.json",
    Buffer.from(
      JSON.stringify(
        {
          ports: [8080],
          securePorts: [],
          bindHost: "0.0.0.0",
          dataDir: "./data",
        },
        null,
        2,
      ),
    ),
  );
  install.set(
    "start.cmd",
    Buffer.from(
      '@echo off\r\ncd /d "%~dp0"\r\n"%~dp0runtime\\node.exe" "%~dp0launcher.js" "%~dp0."\r\n',
    ),
  );
  install.set(
    "start.sh",
    Buffer.from(
      '#!/bin/sh\ncd -- "$(dirname -- "$0")" || exit 1\nexec ./runtime/node ./launcher.js .\n',
    ),
  );
  install.set(
    "install-task.ps1",
    Buffer.from(String.raw`$ErrorActionPreference = "Stop"
$action = New-ScheduledTaskAction -Execute "$PSScriptRoot\runtime\node.exe" -Argument ('"{0}" "{1}"' -f "$PSScriptRoot\launcher.js", $PSScriptRoot) -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName "TalosII" -Action $action -Trigger $trigger -Description "Talos II 当前用户登录时启动（Office 捕获需要交互桌面）"
`),
  );
  install.set(
    "talos.service",
    Buffer.from(
      "[Unit]\nDescription=Talos II\nAfter=network.target\n[Service]\nWorkingDirectory=%h/talos\nExecStart=%h/talos/runtime/node %h/talos/launcher.js %h/talos\nRestart=on-failure\nKillMode=mixed\nTimeoutStopSec=20\n[Install]\nWantedBy=default.target\n",
    ),
  );
  install.set(
    "README.md",
    Buffer.from(
      `# Talos II ${build} (${platform})\n\n解压到独立目录。Windows 双击 start.cmd；Linux 执行 sh start.sh。可选自启动：Windows 在当前用户 PowerShell 中运行 install-task.ps1 注册登录任务；Linux 将 talos.service 中路径改为实际安装目录，作为用户 systemd 单元安装并启用。Office 捕获要求服务器运行在打开 Office 的同一交互用户会话。浏览器访问 http://localhost:8080，根管理员 PIN 首次启动时输出，请妥善保存。数据保存在 data/，切勿删除。\n\n修改 talos.config.json 配置端口及 HTTPS cert/key/ca/domain。证书路径相对安装目录，证书变更自动重载。HTTP→HTTPS 可设 redirect:true，308 响应不缓存。首次离线安装需要 HTTPS 或 localhost。\n\n在运维面板上传完全匹配目标 ${platform} 的 -update.zip，准备后应用，并在三分钟内确认。未确认会回滚应用及完整备份；期间暂停业务写入以避免回滚丢失新写入。更新清单 SHA-256 校验防损坏；仅安装可信来源的软件包。\n\n恢复：停止启动器，使用 runtime/node（Windows runtime\\node.exe）运行 releases/<current>/server.js restore <备份.talos-backup 或 .backup 目录>。备份以流式保存 SQLite 与所有账本对象，无配置大小上限；下载为 .talos-backup 流式归档，恢复也可直接使用 data/backups/<编号>.backup 目录；恢复前保留 data/。data/backups/ 默认保留五份，可调整。\n\nLinux 系统库及 pdfrender GPL 许可见 releases/${build}/vendor/pdfrender/README.md 和各平台目录。两个 Linux 构建需要匹配发行版 ABI、字体、glibc、libstdc++、Cairo、fontconfig、FreeType、JPEG、OpenJPEG、WebP、zstd、zlib、PNG 等。Windows 已包含非系统 DLL，无需安装 Node。\n\n启动器拒绝重复实例。异常断电留下 launcher.lock 时，先确认其中 PID 已退出再删除锁。日志 data/logs/launcher.log 自动轮转。系统服务停止应发送 SIGTERM，Windows 控制台关闭通过 SIGHUP 尽力退出；强制结束无法保证清理。\n`,
    ),
  );
  const name = `talos-${build}-${platform}.${platform === "win32-x64" ? "zip" : "tar.gz"}`;
  await writeFile(
    join(out, name),
    platform === "win32-x64" ? writeZip(install) : tarGz(install),
  );
  console.log(name);
}
