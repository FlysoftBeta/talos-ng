import type {
  LearningCorpus,
  LearningProgress,
  LearningWord,
} from "@talos/contract";
import type { Row } from "@talos/sync";
import type { Db } from "../../kernel/persistence/db.ts";
interface RecordRow {
  id: string;
  body: string;
  rev: number;
  deleted: number;
}
export class LearningRepo {
  constructor(private readonly db: Db) {}
  words(): LearningWord[] {
    return this.db
      .all<{ id: string; english: string; definition: string }>(
        "SELECT * FROM learning_words ORDER BY id",
      )
      .map((w) => [w.id, w.english, w.definition]);
  }
  hasWord(id: string): boolean {
    return !!this.db.get("SELECT 1 FROM learning_words WHERE id=?", id);
  }
  insert(word: LearningWord): void {
    this.db.run("INSERT INTO learning_words VALUES(?,?,?)", ...word);
  }
  corpus(): Row | undefined {
    const row = this.db.get<RecordRow>("SELECT * FROM learning_corpus LIMIT 1");
    return row && this.row("learningCorpus", row);
  }
  putCorpus(corpus: LearningCorpus, rev: number): void {
    this.db.run(
      "INSERT INTO learning_corpus(id,body,rev) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,rev=excluded.rev",
      corpus.id,
      JSON.stringify(corpus),
      rev,
    );
  }
  progress(user: string, word: string): Row | undefined {
    const row = this.db.get<RecordRow>(
      "SELECT word_id AS id,body,rev,deleted FROM learning_progress WHERE user_id=? AND word_id=?",
      user,
      word,
    );
    return row && this.row("learningProgress", row);
  }
  putProgress(user: string, progress: LearningProgress, rev: number): void {
    this.db.run(
      "INSERT INTO learning_progress(user_id,word_id,body,rev) VALUES(?,?,?,?) ON CONFLICT(user_id,word_id) DO UPDATE SET body=excluded.body,rev=excluded.rev",
      user,
      progress.id,
      JSON.stringify(progress),
      rev,
    );
  }
  select(user: string, since: number, limit: number): Row[] {
    return this.db
      .all<RecordRow>(
        "SELECT word_id AS id,body,rev,deleted FROM learning_progress WHERE user_id=? AND rev>? ORDER BY rev,word_id LIMIT ?",
        user,
        since,
        limit,
      )
      .map((row) => this.row("learningProgress", row));
  }
  private row(type: string, row: RecordRow): Row {
    return {
      type,
      id: row.id,
      rev: row.rev,
      deleted: !!row.deleted,
      data: row.deleted ? null : (JSON.parse(row.body) as unknown),
    };
  }
}
