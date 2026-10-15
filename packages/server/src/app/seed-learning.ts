import { DirectoryRepo } from "../modules/identity/index.ts";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AppError, utf8Encode } from "@talos/base";
import { Db } from "../kernel/persistence/db.ts";
import { Uow } from "../kernel/persistence/uow.ts";
import { LearningService } from "../modules/learning/index.ts";
/** Trusted operator CLI. Targets an existing server database; does not bootstrap users. */
export async function seedLearningFile(
  database: string,
  file: string,
): Promise<number> {
  const text = await readFile(resolve(file), "utf8").catch(() => {
    throw new AppError("E_UNAVAILABLE", "无法读取词库文件");
  });
  const db = new Db(resolve(database));
  try {
    if (!new DirectoryRepo(db).initialized())
      throw new AppError("E_INVALID", "请先启动服务器以创建数据库");
    const uow = new Uow(db, { committed() {} });
    const learning = new LearningService({ db, uow });
    const chunks: string[] = [];
    let batch = "";
    for (const record of text.split("￥")) {
      if (utf8Encode(record).length > 180 * 1024) continue;
      if (utf8Encode(batch + record).length > 170 * 1024) {
        chunks.push(batch);
        batch = "";
      }
      batch += record + "￥";
    }
    if (batch) chunks.push(batch);
    // Entire file is atomic, including the compressed-corpus capacity check.
    return uow.write(() =>
      chunks.reduce((n, chunk) => n + learning.import(chunk).imported, 0),
    );
  } finally {
    db.close();
  }
}
