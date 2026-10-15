import { AppError } from "@talos/base";
import type { Db } from "../persistence/db.ts";
import type { Job, JobState } from "./jobs-types.ts";

interface JobRecord {
  id: string;
  kind: string;
  owner: string;
  payload: string;
  state: JobState;
  progress: number;
  message: string;
  result: string;
  error: string;
  attempts: number;
  run_after: number;
  created: number;
  updated: number;
  rev: number;
  deleted: number;
}
export class JobRepo {
  purgeUser(owner: string): void {
    this.db.run("DELETE FROM jobs WHERE owner=?", owner);
  }
  constructor(private readonly db: Db) {}
  get(id: string): Job | undefined {
    const record = this.db.get<JobRecord>(
      "SELECT * FROM jobs WHERE id = ?",
      id,
    );
    return record ? decode(record) : undefined;
  }
  list(owner: string, sinceRev = -1, limit = Number.MAX_SAFE_INTEGER): Job[] {
    return this.db
      .all<JobRecord>(
        "SELECT * FROM jobs WHERE owner = ? AND rev > ? ORDER BY rev,id LIMIT ?",
        owner,
        sinceRev,
        limit,
      )
      .map(decode);
  }
  activeJobs(kind: string, owner?: string): Job[] {
    return this.db
      .all<JobRecord>(
        "SELECT * FROM jobs WHERE kind=? AND state IN ('queued','running') AND deleted=0" +
          (owner === undefined ? "" : " AND owner=?"),
        kind,
        ...(owner === undefined ? [] : [owner]),
      )
      .map(decode);
  }
  running(): Job[] {
    return this.db
      .all<JobRecord>(
        "SELECT * FROM jobs WHERE state = 'running' AND deleted = 0",
      )
      .map(decode);
  }
  due(kind: string, now: number, limit: number): Job[] {
    return this.db
      .all<JobRecord>(
        "SELECT * FROM jobs WHERE kind = ? AND state = 'queued' AND deleted = 0 AND run_after <= ? ORDER BY run_after,created,id LIMIT ?",
        kind,
        now,
        limit,
      )
      .map(decode);
  }
  next(kind: string): number | undefined {
    return (
      this.db.get<{ time: number | null }>(
        "SELECT MIN(run_after) AS time FROM jobs WHERE kind = ? AND state = 'queued' AND deleted = 0",
        kind,
      )?.time ?? undefined
    );
  }
  put(job: Job): void {
    this.db.run(
      `INSERT INTO jobs(id,kind,owner,payload,state,progress,message,result,error,attempts,run_after,created,updated,rev,deleted)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      state=excluded.state,progress=excluded.progress,message=excluded.message,result=excluded.result,
      error=excluded.error,attempts=excluded.attempts,run_after=excluded.run_after,updated=excluded.updated,
      rev=excluded.rev,deleted=excluded.deleted`,
      job.id,
      job.kind,
      job.owner,
      encode(job.payload),
      job.state,
      job.progress,
      job.message,
      encode(job.result),
      encode(job.error),
      job.attempts,
      job.runAfter,
      job.created,
      job.updated,
      job.rev,
      job.deleted ? 1 : 0,
    );
  }
}
function decode(record: JobRecord): Job {
  return {
    id: record.id,
    kind: record.kind,
    owner: record.owner,
    payload: JSON.parse(record.payload) as unknown,
    state: record.state,
    progress: record.progress,
    message: record.message,
    result: JSON.parse(record.result) as unknown,
    error: JSON.parse(record.error) as Job["error"],
    attempts: record.attempts,
    runAfter: record.run_after,
    created: record.created,
    updated: record.updated,
    rev: record.rev,
    deleted: record.deleted === 1,
  };
}
function encode(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("undefined");
    return encoded;
  } catch {
    throw new AppError("E_INVALID", "任务数据必须可序列化为 JSON");
  }
}
