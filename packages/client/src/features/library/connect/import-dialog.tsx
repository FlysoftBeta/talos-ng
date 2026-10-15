import { useState } from "react";
import type { ReactElement } from "react";
import {
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import { fileSource } from "../adapters/file-source.ts";
import {
  attachmentError,
  canStartImport,
  importDocument,
  titleFromFileName,
} from "../model/import.ts";
import { writableCollections } from "../model/library-data.ts";
import { ImportDialogView } from "../view/import-dialog.tsx";
import { useLibrary } from "./use-library.ts";

export function ImportDialog({
  onClose,
  collection,
}: {
  onClose: () => void;
  collection?: string;
}): ReactElement {
  const runtime = useRuntime(),
    user = useClientSnapshot().user,
    data = useLibrary(),
    [target, setTarget] = useState(
      collection ??
        data.collections.find((c) => c.builtin === "shelf")?.id ??
        "",
    ),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [file, setFile] = useState<File>(),
    [error, setError] = useState("");
  return (
    <ImportDialogView
      title={title}
      onTitle={setTitle}
      body={body}
      onBody={setBody}
      hasFile={!!file}
      onFile={(value) => {
        setError("");
        const tooLarge = value && attachmentError(value.size);
        if (tooLarge) {
          setError(tooLarge);
          return;
        }
        setFile(value);
        if (value && !title) setTitle(titleFromFileName(value.name));
      }}
      onRemoveFile={() => setFile(undefined)}
      destinations={user ? writableCollections(data, user.id) : []}
      collection={target}
      onCollection={setTarget}
      error={error}
      canStart={canStartImport(title, body, !!file)}
      onStart={() => {
        onClose();
        runtime.dispatch({ type: "openOverlay", overlay: { kind: "tasks" } });
        void importDocument(runtime, {
          title,
          body,
          source: file && fileSource(file),
          collection: target || undefined,
        });
      }}
      onClose={onClose}
    />
  );
}
