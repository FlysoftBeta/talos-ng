/** Hands a text file to the browser's download mechanism. */
export function downloadText(filename: string, body: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([body], { type: "text/plain;charset=utf-8" }),
  );
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Starts a download from a server-issued ticket URL. */
export function downloadUrl(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** Raises an uncaught error on the window so the client's incident reporter records it. */
export function raiseClientFault(message: string): void {
  window.setTimeout(() => {
    throw new Error(message);
  }, 0);
}
