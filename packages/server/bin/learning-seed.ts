import { AppError } from "@talos/base";
import { seedLearningFile } from "../src/app/seed-learning.ts";
const [database, file] = process.argv.slice(2);
if (!database || !file) {
  process.stderr.write(
    "用法: node --import tsx packages/server/bin/learning-seed.ts <talos.db> <words.txt>\n",
  );
  process.exitCode = 1;
} else {
  try {
    process.stdout.write(
      `已导入 ${await seedLearningFile(database, file)} 个单词\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof AppError ? error.message : "导入失败，请检查文件和数据库权限"}\n`,
    );
    process.exitCode = 1;
  }
}
