import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { Dialog } from "../../../ui/overlays/index.ts";
import {
  Field,
  FileField,
  SelectField,
  TextArea,
} from "../../../ui/inputs/index.ts";
import { InlineNotice } from "../../../ui/feedback/index.ts";
import { Stack } from "../../../ui/layout/index.ts";
import { Segmented } from "../../../ui/navigation/index.ts";
import "./library.css";

export interface ImportDialogViewProps {
  title: string;
  onTitle: (value: string) => void;
  body: string;
  onBody: (value: string) => void;
  hasFile: boolean;
  onFile: (file: File | undefined) => void;
  onRemoveFile: () => void;
  /** Booklists the document may be added to; empty string keeps it on the shelf only. */
  destinations: { id: string; title: string }[];
  collection: string;
  onCollection: (id: string) => void;
  error: string;
  canStart: boolean;
  onStart: () => void;
  onClose: () => void;
}
type Kind = "text" | "pdf";
export function ImportDialogView(props: ImportDialogViewProps): ReactElement {
  const [kind, setKind] = useState<Kind>("text"),
    [picker, setPicker] = useState(0);
  const reset = () => {
    props.onRemoveFile();
    setPicker(picker + 1);
  };
  return (
    <Dialog
      open
      title="导入文档"
      onClose={props.onClose}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={!props.canStart}
            onClick={props.onStart}
          >
            开始导入
          </Button>
        </>
      }
    >
      <Stack className="lib-import">
        <Segmented
          label="文档类型"
          block
          value={kind}
          options={[
            { value: "text", label: "文本" },
            { value: "pdf", label: "PDF" },
          ]}
          onChange={(value) => {
            if (value !== kind) reset();
            setKind(value);
          }}
        />
        {props.destinations.length > 0 && (
          <SelectField
            label="加入书单"
            value={props.collection}
            onChange={(e) => props.onCollection(e.target.value)}
          >
            <option value="">我的书架（默认）</option>
            {props.destinations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </SelectField>
        )}
        <Field
          label="标题"
          maxLength={200}
          value={props.title}
          onChange={(e) => props.onTitle(e.target.value)}
        />
        {kind === "text" ? (
          <>
            <TextArea
              label="正文"
              rows={8}
              value={props.body}
              disabled={props.hasFile}
              hint={props.hasFile ? "已选择文本文件，正文取自文件" : undefined}
              onChange={(e) => props.onBody(e.target.value)}
            />
            <div className="lib-import-file">
              <FileField
                key={picker}
                label="或选择文本文件"
                accept=".txt,text/plain"
                onFile={props.onFile}
              />
              {props.hasFile && (
                <Button variant="ghost" size="small" onClick={reset}>
                  移除文件
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="lib-import-file">
            <FileField
              key={picker}
              label="PDF 文件"
              accept=".pdf,application/pdf"
              onFile={props.onFile}
            />
            {props.hasFile && (
              <Button variant="ghost" size="small" onClick={reset}>
                移除文件
              </Button>
            )}
          </div>
        )}
        {props.error && (
          <InlineNotice tone="failed">{props.error}</InlineNotice>
        )}
        <p className="lib-muted">
          {kind === "text"
            ? "文本文件自动识别 UTF-8 / GBK；转换进度在任务中查看。"
            : "PDF 最大 200 MB；转换进度在任务中查看。"}
        </p>
      </Stack>
    </Dialog>
  );
}
