import { AppError } from "@talos/base";
import { openAppDb } from "./database.ts";
/** Deletes only application data. Installed releases live in talos-shell. */
export async function rebuildAppData(
  device: string | undefined,
  factory: IDBFactory = indexedDB,
  onBlocked?: () => void,
  keyRange: typeof IDBKeyRange = IDBKeyRange,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase("talos-app");
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(
        new AppError("E_INTERNAL", "无法清除本机数据，请重新打开应用后重试"),
      );
    request.onblocked = () => onBlocked?.();
  });
  const db = await openAppDb({ indexedDB: factory, keyRange });
  try {
    if (device) await db.table<string, string>("session").put(device, "device");
  } finally {
    db.close();
  }
}
