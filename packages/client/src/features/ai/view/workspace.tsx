import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { Sheet, ConfirmDialog, Menu } from "../../../ui/overlays/index.ts";
import { Field, TextArea } from "../../../ui/inputs/index.ts";
import { ListRow, StatePanel } from "../../../ui/feedback/index.ts";
import { Inline, Stack } from "../../../ui/layout/index.ts";
import {
  fileSizeLabel,
  isAttachment,
  previewKind,
  svgDataUrl,
} from "../model/workspace.ts";
import type {
  WorkspaceController,
  WorkspaceState,
} from "../model/workspace.ts";
import type { AiFile } from "@talos/contract";
import { Icon } from "../../../ui/icon/index.ts";
import "./ai.css";

export type WorkspaceActions = Pick<
  WorkspaceController,
  | "createFile"
  | "setPath"
  | "setText"
  | "togglePreview"
  | "askDelete"
  | "cancelDelete"
  | "select"
  | "save"
  | "remove"
>;
export function WorkspaceSheetView({
  open,
  onClose,
  state,
  actions,
  renderMarkdown,
}: {
  open: boolean;
  onClose: () => void;
  state: WorkspaceState;
  actions: WorkspaceActions;
  renderMarkdown: (text: string) => ReactNode;
}): ReactElement {
  const [folder, setFolder] = useState("");
  const { files, selected, path, text, error, loading, confirm, preview } =
      state,
    can = state.list,
    writeCan = state.write,
    readOnly = isAttachment(selected);
  const folders = Array.from(
    new Set(
      files
        .filter((f) => f.path.startsWith(folder))
        .map((f) => f.path.slice(folder.length).split("/"))
        .filter((parts) => parts.length > 1)
        .map((parts) => parts[0]!),
    ),
  );
  return (
    <Sheet
      open={open}
      title="工作区"
      onClose={onClose}
      actions={
        <Button
          variant="ghost"
          icon="plus"
          disabledReason={!writeCan.ok ? writeCan.reason : undefined}
          onClick={actions.createFile}
        >
          新建文件
        </Button>
      }
      footer={
        path && !readOnly ? (
          <>
            <Button onClick={onClose}>取消</Button>
            <Button
              variant="primary"
              disabledReason={!writeCan.ok ? writeCan.reason : undefined}
              onClick={() => void actions.save()}
            >
              保存文件
            </Button>
          </>
        ) : undefined
      }
    >
      <Stack>
        <p>每人 10 MiB / 256 个文件 · {files.length} 个文件</p>
        {error && <StatePanel state="error" hint={error} />}{" "}
        {!can.ok && (
          <p role="status">{can.reason}；已打开过的文件可离线查看。</p>
        )}
        <nav className="ai-breadcrumbs" aria-label="工作区路径">
          <Button variant="ghost" onClick={() => setFolder("")}>
            工作区
          </Button>
          {folder
            .split("/")
            .filter(Boolean)
            .map((part, i, parts) => (
              <Button
                key={i}
                variant="ghost"
                onClick={() => setFolder(parts.slice(0, i + 1).join("/") + "/")}
              >
                {part}
              </Button>
            ))}
        </nav>
        {loading ? (
          <StatePanel state="loading" />
        ) : !files.length ? (
          <StatePanel
            state={can.ok ? "empty" : "offline"}
            title={can.ok ? "工作区为空" : "离线未缓存"}
          />
        ) : (
          <nav aria-label="工作区文件树">
            {folders.map((name) => (
              <ListRow
                key={name}
                title={name}
                leading={<Icon name="folder" />}
                onClick={() => setFolder(folder + name + "/")}
              />
            ))}
            {files
              .filter((f) => f.path.startsWith(folder))
              .map((f: AiFile) => (
                <ListRow
                  key={f.path}
                  title={f.path}
                  hint={fileSizeLabel(f.size)}
                  leading={<Icon name="file" />}
                  selected={selected?.path === f.path}
                  onClick={() => void actions.select(f)}
                />
              ))}
          </nav>
        )}
        {path && (
          <section className="ai-editor" data-testid="ai.workspace.editor">
            <Field
              label="文件路径"
              value={path}
              disabled={!!selected}
              onChange={(e) => actions.setPath(e.target.value)}
            />
            <Inline>
              <Button onClick={actions.togglePreview}>
                {preview ? "编辑源码" : "预览文件"}
              </Button>
              {selected && !readOnly && (
                <Menu
                  label="文件操作"
                  items={[
                    {
                      label: "删除文件",
                      icon: "trash",
                      danger: true,
                      disabledReason: !writeCan.ok
                        ? writeCan.reason
                        : undefined,
                      onSelect: actions.askDelete,
                    },
                  ]}
                />
              )}
            </Inline>
            {preview ? (
              previewKind(path, text) === "raster" ? (
                <img className="ai-image" alt={path} src={text} />
              ) : previewKind(path, text) === "svg" ? (
                <img className="ai-image" alt={path} src={svgDataUrl(text)} />
              ) : (
                renderMarkdown(text)
              )
            ) : (
              <TextArea
                label="文件内容"
                rows={12}
                value={text}
                disabled={!writeCan.ok || readOnly}
                onChange={(e) => actions.setText(e.target.value)}
              />
            )}
            {!writeCan.ok && <p>{writeCan.reason}</p>}
          </section>
        )}
      </Stack>
      <ConfirmDialog
        open={confirm}
        objectName={path}
        destructive
        onClose={actions.cancelDelete}
        onConfirm={() => void actions.remove()}
        message="此操作会永久删除工作区文件。"
      />
    </Sheet>
  );
}
