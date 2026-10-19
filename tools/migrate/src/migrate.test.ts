import { createHash, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { zipSync } from "fflate";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { createApi } from "@talos/contract";
import { deferred } from "@talos/base";
import { createMemoryCarrierPair, LinkClient } from "@talos/link";
import { createFsObjectStore } from "@talos/objectstore";
import { Db, createKernel } from "@talos/server/migration";
import { legacyUlid } from "./journal.ts";
import { main } from "./main.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
const secret = "0123456789abcdef".repeat(4);
const alice = "11111111-1111-4111-8111-111111111111";
const group = "22222222-2222-4222-8222-222222222222";
const post = "33333333-3333-4333-8333-333333333333";
const article = "44444444-4444-4444-8444-444444444444";
const word = "55555555-5555-4555-8555-555555555555";
const conversation = "66666666-6666-4666-8666-666666666666";
const message = "77777777-7777-4777-8777-777777777777";
async function fixture(): Promise<{
  source: string;
  target: string;
  dir: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "talos-migrate-test-"));
  dirs.push(dir);
  const source = join(dir, "data.db"),
    target = join(dir, "target");
  const db = new DatabaseSync(source);
  // These declarations are copied from classapp-next/server/infra/db.ts's current schema.
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,handle TEXT UNIQUE NOT NULL,username TEXT NOT NULL,profile_revision INTEGER NOT NULL DEFAULT 0,feature_bitset INTEGER NOT NULL DEFAULT 0,is_muted INTEGER NOT NULL DEFAULT 0,muted_until TEXT,banned_until TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS user_pins (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,pin_hash TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY,conv_id TEXT NOT NULL UNIQUE CHECK (conv_id = 'group:' || id),revision INTEGER NOT NULL DEFAULT 0,handle TEXT NOT NULL UNIQUE,name TEXT NOT NULL,discoverable INTEGER NOT NULL DEFAULT 0 CHECK (discoverable IN (0, 1)),password_hash TEXT,type TEXT NOT NULL DEFAULT 'normal',members_hidden INTEGER NOT NULL DEFAULT 0 CHECK (members_hidden IN (0, 1)),admin_only INTEGER NOT NULL DEFAULT 0 CHECK (admin_only IN (0, 1)),no_leave INTEGER NOT NULL DEFAULT 0 CHECK (no_leave IN (0, 1)),parent_group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS group_members (group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,joined_at TEXT NOT NULL DEFAULT (datetime('now')),hide_self INTEGER NOT NULL DEFAULT 0 CHECK (hide_self IN (0, 1)),PRIMARY KEY (group_id, user_id));
    CREATE TABLE IF NOT EXISTS posts (sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,conv_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,author_id TEXT REFERENCES users(id) ON DELETE SET NULL,brief TEXT NOT NULL DEFAULT '',content_json TEXT NOT NULL CHECK (json_valid(content_json)),reply_to TEXT REFERENCES posts(id) ON DELETE SET NULL,deleted_at TEXT,edited_at TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),CHECK ((json_extract(content_json, '$.type') = 'deleted') = (deleted_at IS NOT NULL)),CHECK (deleted_at IS NULL OR content_json = '{"type":"deleted"}'),CHECK (json_extract(content_json, '$.type') != 'text' OR content_json = '{"type":"text","text_same_as_brief":true}'));
    CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE SET NULL,title TEXT NOT NULL,provider_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS text_article_segments (article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,segment_index INTEGER NOT NULL,start_offset INTEGER NOT NULL,char_count INTEGER NOT NULL,content TEXT NOT NULL,PRIMARY KEY(article_id,segment_index));
    CREATE TABLE IF NOT EXISTS words (id TEXT PRIMARY KEY,english TEXT NOT NULL,phonetic TEXT NOT NULL DEFAULT '',definition TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS user_word_progress (user_id TEXT NOT NULL,word_id TEXT NOT NULL,learned_count INTEGER NOT NULL DEFAULT 0,wrong_count INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'unlearned',last_practiced_at TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')),PRIMARY KEY(user_id,word_id));
    CREATE TABLE IF NOT EXISTS ai_conversations (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,title TEXT NOT NULL,title_norm TEXT NOT NULL,active_leaf_message_id TEXT,forked_from_conversation_id TEXT,forked_from_message_id TEXT,last_assistant_sequence INTEGER NOT NULL DEFAULT 0,last_read_assistant_sequence INTEGER NOT NULL DEFAULT 0,archived_at TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS ai_messages (sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,conversation_id TEXT NOT NULL,parent_message_id TEXT,role TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',attachments_json TEXT NOT NULL DEFAULT '[]',status TEXT NOT NULL,run_id TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS post_images (id TEXT PRIMARY KEY,post_id TEXT UNIQUE REFERENCES posts(id),blob_id TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL CHECK(bytes>0),width INTEGER NOT NULL CHECK(width>0),height INTEGER NOT NULL CHECK(height>0),sha256 TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS post_image_thumbs (image_id TEXT PRIMARY KEY REFERENCES post_images(id) ON DELETE CASCADE,blob_id TEXT,mime TEXT,bytes INTEGER NOT NULL DEFAULT 0,width INTEGER NOT NULL DEFAULT 0,height INTEGER NOT NULL DEFAULT 0,sha256 TEXT,state TEXT NOT NULL,generation INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS media_tracks (id TEXT PRIMARY KEY,source TEXT NOT NULL,provider_id TEXT NOT NULL,canonical_url TEXT NOT NULL,title TEXT NOT NULL,artists_json TEXT NOT NULL DEFAULT '[]',album TEXT,duration_ms INTEGER NOT NULL,thumbnail_url TEXT,metadata_revision INTEGER NOT NULL DEFAULT 0,ref_count INTEGER NOT NULL DEFAULT 0,last_used_at TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')),UNIQUE(source,provider_id));
    CREATE TABLE IF NOT EXISTS media_assets (track_id TEXT NOT NULL REFERENCES media_tracks(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK (kind IN ('audio', 'cover')),state TEXT NOT NULL CHECK (state IN ('queued', 'downloading', 'ready', 'failed')),blob_id TEXT UNIQUE,mime TEXT,bytes INTEGER NOT NULL DEFAULT 0,sha256 TEXT,failed_code TEXT,downloaded_at TEXT,updated_at TEXT NOT NULL DEFAULT (datetime('now')),PRIMARY KEY (track_id,kind));
    CREATE TABLE IF NOT EXISTS media_lists (id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,retention_days INTEGER NOT NULL DEFAULT 7,expires_at TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS media_list_items (list_id TEXT NOT NULL,position INTEGER NOT NULL,track_id TEXT NOT NULL,added_at TEXT NOT NULL DEFAULT (datetime('now')),PRIMARY KEY(list_id,position));
    CREATE TABLE IF NOT EXISTS ai_workspaces (user_id TEXT PRIMARY KEY,blob_id TEXT,staging_blob_id TEXT,updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  db.exec(`CREATE TABLE IF NOT EXISTS ai_runs (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id   TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    input_message_id  TEXT NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
    output_message_id TEXT NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
    status            TEXT NOT NULL CHECK (
      status IN ('queued', 'routing', 'running', 'completed', 'failed', 'cancelled')
    ),
    revision          INTEGER NOT NULL DEFAULT 0,
    model_placeholder TEXT,
    provider_model    TEXT,
    reasoning_effort  TEXT,
    reserved_credit_micros INTEGER NOT NULL DEFAULT 0,
    charged_credit_micros  INTEGER NOT NULL DEFAULT 0,
    input_tokens      INTEGER NOT NULL DEFAULT 0,
    cached_input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens     INTEGER NOT NULL DEFAULT 0,
    cancel_requested  INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
    error             TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
CREATE TABLE IF NOT EXISTS booklists (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    revision    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
CREATE TABLE IF NOT EXISTS booklist_items (
    booklist_id TEXT NOT NULL REFERENCES booklists(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL CHECK (position >= 0),
    article_id  TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    added_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (booklist_id, position)
  );
CREATE TABLE IF NOT EXISTS group_booklists (
    group_id    TEXT PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
    booklist_id TEXT NOT NULL UNIQUE REFERENCES booklists(id) ON DELETE CASCADE
  );
CREATE TABLE IF NOT EXISTS access_bindings (
    resource_kind  TEXT NOT NULL,
    resource_id    TEXT NOT NULL,
    principal_kind TEXT NOT NULL CHECK (principal_kind IN ('user', 'group')),
    principal_id   TEXT NOT NULL,
    grants_json    TEXT NOT NULL CHECK (json_valid(grants_json)),
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (resource_kind, resource_id, principal_kind, principal_id)
  );
CREATE TABLE IF NOT EXISTS resource_possession (
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource_kind  TEXT NOT NULL,
    resource_id    TEXT NOT NULL,
    capability     TEXT NOT NULL,
    source_kind    TEXT NOT NULL,
    source_id      TEXT,
    expires_at_ms  INTEGER NOT NULL,
    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, resource_kind, resource_id)
  );
CREATE TABLE IF NOT EXISTS user_favorites (
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource_kind  TEXT NOT NULL,
    resource_id    TEXT NOT NULL,
    favorited      INTEGER NOT NULL DEFAULT 1 CHECK (favorited IN (0, 1)),
    updated_at_ms  INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, resource_kind, resource_id)
  );
CREATE TABLE IF NOT EXISTS user_queues (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    list_id TEXT NOT NULL UNIQUE REFERENCES media_lists(id) ON DELETE CASCADE
  );
CREATE TABLE IF NOT EXISTS ai_credit_accounts (
    user_id                TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    top_up_credit_micros   INTEGER NOT NULL DEFAULT 0 CHECK (top_up_credit_micros >= 0),
    reserved_credit_micros INTEGER NOT NULL DEFAULT 0 CHECK (reserved_credit_micros >= 0),
    updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
  );
CREATE TABLE IF NOT EXISTS ai_credit_ledger (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('top_up', 'reserve', 'settle', 'release')),
    delta_credit_micros        INTEGER NOT NULL,
    top_up_after_credit_micros INTEGER NOT NULL CHECK (top_up_after_credit_micros >= 0),
    run_id          TEXT REFERENCES ai_runs(id) ON DELETE SET NULL,
    admin_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    note            TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
CREATE TABLE IF NOT EXISTS ai_credit_reservations (
    operation_id TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_id       TEXT REFERENCES ai_runs(id) ON DELETE SET NULL,
    amount_credit_micros INTEGER NOT NULL CHECK (amount_credit_micros >= 0),
    status       TEXT NOT NULL CHECK (status IN ('active', 'settled', 'released')),
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
CREATE TABLE IF NOT EXISTS ai_plan_enrollments (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    starts_at  TEXT NOT NULL,
    ends_at    TEXT NOT NULL,
    assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (ends_at > starts_at)
  );`);
  db.prepare("INSERT INTO config VALUES(?,?)").run("pin_secret", secret);
  db.prepare(
    "INSERT INTO users(id,handle,username,feature_bitset,created_at) VALUES(?,?,?,?,?)",
  ).run(alice, "alice", "Alice", 511, "2020-01-01 00:00:00");
  db.prepare("INSERT INTO user_pins(id,user_id,pin_hash) VALUES(?,?,?)").run(
    "88888888-8888-4888-8888-888888888888",
    alice,
    createHmac("sha256", secret).update("123456").digest("hex"),
  );
  db.prepare("INSERT INTO groups(id,conv_id,handle,name) VALUES(?,?,?,?)").run(
    group,
    `group:${group}`,
    "class",
    "Class",
  );
  db.prepare("INSERT INTO group_members(group_id,user_id) VALUES(?,?)").run(
    group,
    alice,
  );
  db.prepare(
    "INSERT INTO posts(id,conv_id,author_id,brief,content_json) VALUES(?,?,?,?,?)",
  ).run(
    post,
    `group:${group}`,
    alice,
    "hello",
    '{"type":"text","text_same_as_brief":true}',
  );
  db.prepare(
    "INSERT INTO articles(id,user_id,title,provider_json) VALUES(?,?,?,?)",
  ).run(article, alice, "A document", '{"type":"text","words":2,"chunks":1}');
  db.prepare("INSERT INTO text_article_segments VALUES(?,?,?,?,?)").run(
    article,
    0,
    0,
    11,
    "hello world",
  );
  db.prepare("INSERT INTO words(id,english,definition) VALUES(?,?,?)").run(
    word,
    "apple",
    "fruit",
  );
  db.prepare(
    "INSERT INTO user_word_progress(user_id,word_id,learned_count,wrong_count) VALUES(?,?,?,?)",
  ).run(alice, word, 2, 1);
  db.prepare(
    "INSERT INTO ai_conversations(id,user_id,title,title_norm) VALUES(?,?,?,?)",
  ).run(conversation, alice, "chat", "chat");
  db.prepare(
    "INSERT INTO ai_messages(id,conversation_id,role,content,status) VALUES(?,?,?,?,?)",
  ).run(message, conversation, "user", "hello AI", "completed");
  db.close();
  return { source, target, dir };
}

const bob = "99999999-9999-4999-8999-999999999999";
const playlist = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const booklist = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const migratedTrack = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const audioBlob = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
async function completionFixture(): ReturnType<typeof fixture> {
  const f = await fixture(),
    db = new DatabaseSync(f.source);
  db.prepare(
    "INSERT INTO users(id,handle,username,feature_bitset) VALUES(?,?,?,511)",
  ).run(bob, "bob", "Bob");
  db.prepare("INSERT INTO booklists(id,title) VALUES(?,?)").run(
    booklist,
    "Shared books",
  );
  db.prepare(
    "INSERT INTO booklist_items(booklist_id,position,article_id) VALUES(?,0,?)",
  ).run(booklist, article);
  db.prepare(
    "INSERT INTO media_tracks(id,source,provider_id,canonical_url,title,duration_ms) VALUES(?,?,?,?,?,?)",
  ).run(
    migratedTrack,
    "youtube",
    "fixture",
    "https://example.invalid",
    "Song",
    1000,
  );
  const audio = Buffer.from("audio fixture"),
    hash = createHash("sha256").update(audio).digest("hex");
  db.prepare(
    "INSERT INTO media_assets(track_id,kind,state,blob_id,mime,bytes,sha256) VALUES(?,'audio','ready',?,'audio/mpeg',?,?)",
  ).run(migratedTrack, audioBlob, audio.length, hash);
  db.prepare(
    "INSERT INTO media_lists(id,kind,title,retention_days,created_at,expires_at) VALUES(?,'playlist','Shared songs',30,'2020-01-01 00:00:00','2020-02-01 00:00:00')",
  ).run(playlist);
  db.prepare(
    "INSERT INTO media_list_items(list_id,position,track_id) VALUES(?,0,?)",
  ).run(playlist, migratedTrack);
  const queue = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  db.prepare(
    "INSERT INTO media_lists(id,kind,title) VALUES(?,'queue','Queue')",
  ).run(queue);
  db.prepare(
    "INSERT INTO media_list_items(list_id,position,track_id) VALUES(?,0,?)",
  ).run(queue, migratedTrack);
  db.prepare("INSERT INTO user_queues VALUES(?,?)").run(alice, queue);
  db.prepare(
    "INSERT INTO user_favorites(user_id,resource_kind,resource_id,updated_at_ms) VALUES(?,'track',?,1234)",
  ).run(alice, migratedTrack);
  for (const [kind, id] of [
    ["booklist", booklist],
    ["playlist", playlist],
  ] as const) {
    db.prepare(
      "INSERT INTO access_bindings(resource_kind,resource_id,principal_kind,principal_id,grants_json) VALUES(?,?,'user',?,?)",
    ).run(kind, id, bob, '[{"mode":"owner"}]');
    db.prepare(
      "INSERT INTO access_bindings(resource_kind,resource_id,principal_kind,principal_id,grants_json) VALUES(?,?,'user',?,?)",
    ).run(kind, id, alice, '[{"mode":"read","shareable":true}]');
  }
  db.prepare(
    "INSERT INTO ai_credit_accounts(user_id,top_up_credit_micros,reserved_credit_micros) VALUES(?,123456789,99)",
  ).run(alice);
  db.prepare(
    "INSERT INTO ai_credit_accounts(user_id,top_up_credit_micros) VALUES(?,7)",
  ).run(bob);
  db.prepare(
    "INSERT INTO ai_credit_reservations(operation_id,user_id,amount_credit_micros,status) VALUES('operation',?,99,'active')",
  ).run(alice);
  db.prepare(
    "INSERT INTO ai_credit_ledger(id,user_id,kind,delta_credit_micros,top_up_after_credit_micros,idempotency_key,note) VALUES('ledger',?,'top_up',123456789,123456789,'legacy-topup','topup')",
  ).run(alice);
  const novel = "12121212-1212-4212-8212-121212121212";
  db.prepare(
    "INSERT INTO articles(id,user_id,title,provider_json) VALUES(?,?,'Downloaded novel',?)",
  ).run(novel, alice, JSON.stringify({ type: "text", words: 8, chunks: 1 }));
  db.prepare(
    "INSERT INTO text_article_segments VALUES(?,0,0,8,'Chapter 1\nA downloaded chapter')",
  ).run(novel);
  const image = Buffer.from("image fixture"),
    imageHash = createHash("sha256").update(image).digest("hex"),
    entry = "abababab-abab-4bab-8bab-abababababab",
    workspaceBlob = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const manifest = {
    format: "classapp-object-tree",
    version: 1,
    revision: 3,
    entries: [
      {
        id: entry,
        path: "photo.png",
        mime: "image/png",
        size: image.length,
        sha256: imageHash,
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
    ],
  };
  const archive = zipSync({
    "manifest.json": Buffer.from(JSON.stringify(manifest)),
    [`objects/${entry}`]: image,
  });
  db.prepare("INSERT INTO ai_workspaces(user_id,blob_id) VALUES(?,?)").run(
    alice,
    workspaceBlob,
  );
  db.prepare("UPDATE ai_messages SET attachments_json=? WHERE id=?").run(
    JSON.stringify([
      {
        path: "photo.png",
        name: "photo",
        mime: "image/png",
        size: image.length,
      },
    ]),
    message,
  );
  db.close();
  for (const [blob, bytes] of [
    [audioBlob, audio],
    [workspaceBlob, archive],
  ] as const) {
    const compact = blob.replace(/-/g, "");
    const folder = join(
      f.dir,
      "storage",
      "objects",
      compact.slice(0, 2),
      compact.slice(2, 4),
    );
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, blob), bytes);
  }
  return f;
}

it("imports a real-schema fixture, verifies hashes, and serves migrated data over a memory link", async () => {
  const f = await completionFixture();
  await main(["inspect", "--source", f.source]);
  await main(["run", "--source", f.source, "--target", f.target]);
  await main(["verify", "--source", f.source, "--target", f.target]);
  const db = new Db(join(f.target, "talos.db"));
  expect(db.all("SELECT * FROM migration_issues")).toEqual([]);
  const docRow = db.get<{ id: string; source: string }>(
    "SELECT id,source FROM library_documents WHERE json_extract(body,'$.title')='A document'",
  );
  expect(docRow?.id).toBe(
    db.get<{ new_id: string }>(
      "SELECT new_id FROM migration_map WHERE entity='articles' AND legacy_id='44444444-4444-4444-8444-444444444444'",
    )?.new_id,
  );
  expect(
    db.get<{ n: number }>("SELECT count(*) n FROM migration_documents")?.n,
  ).toBe(2);
  expect(docRow?.source).toMatch(/^[a-f0-9]{64}$/);
  const kernel = createKernel({
    db,
    store: createFsObjectStore({ root: f.target }),
    build: "test",
  });
  const ready = deferred<void>();
  const client = new LinkClient({
    connect: async () => {
      const pair = createMemoryCarrierPair();
      kernel.host.link.accept(pair.b, {});
      return pair.a;
    },
    hello: () => ({ v: 1, build: "test", device: null, lang: "zh-CN" }),
  });
  client.onWelcome(() => ready.resolve());
  client.start();
  await ready.promise;
  try {
    const api = createApi(client.call.bind(client));
    await api.auth.device.register({});
    const login = await api.auth.login({ pin: "123456" });
    expect("user" in login).toBe(true);
    if (!("user" in login)) throw new Error("login failed");
    const aiId = db.get<{ new_id: string }>(
      "SELECT new_id FROM migration_map WHERE entity='ai_conversations'",
    )!.new_id;
    const messages = await api.ai.message.page({
      conversation: aiId,
      limit: 10,
    });
    expect(messages.messages[0]?.text).toBe("hello AI");
    expect(messages.messages[0]?.images[0]?.path).toBe("photo.png");
    const trackId = db.get<{ new_id: string }>(
      "SELECT new_id FROM migration_map WHERE entity='media_tracks'",
    )!.new_id;
    const prepared = await api.media.track.prepare({ track: trackId });
    expect(prepared.track.audio?.id).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.job).toBeNull();
    const collectionId = db.get<{ new_id: string }>(
      "SELECT new_id FROM migration_map WHERE entity='booklists'",
    )!.new_id;
    const collectionPull = await api.sync.pull({
      cursors: { [`coll:${collectionId}`]: 0 },
    });
    const shared = collectionPull.scopes[`coll:${collectionId}`]?.rows.find(
      (row) => row.type === "libraryCollection",
    )?.data as { title: string; owner: string };
    expect(shared.title).toBe("Shared books");
    expect(shared.owner).not.toBe(login.user.id);
    const playlistId = db.get<{ new_id: string }>(
      "SELECT new_id FROM migration_map WHERE entity='media_lists' AND legacy_id=?",
      playlist,
    )!.new_id;
    const migratedPlaylist = kernel.media.playlist(playlistId);
    expect(migratedPlaylist.tracks).toEqual([trackId]);
    expect(migratedPlaylist).not.toHaveProperty("retentionDays");
    expect(migratedPlaylist).not.toHaveProperty("lastPlayed");
    expect(db.all("SELECT * FROM media_retentions")).toEqual([]);
    expect(db.all("SELECT * FROM library_retentions")).toEqual([]);
    expect(kernel.media.state(login.user.id).queue).toEqual([trackId]);
    expect(kernel.media.state(login.user.id).favorites[trackId]?.v).toBe(true);
    expect(
      kernel.library.repo.delegation(collectionId, "user", login.user.id),
    ).toBe(true);
    const docId = db.get<{ new_id: string }>(
      "SELECT new_id FROM migration_map WHERE entity='articles' AND legacy_id='44444444-4444-4444-8444-444444444444'",
    )!.new_id;
    await vi.waitFor(
      () => {
        const job = db.get<{ state: string; error: string }>(
          "SELECT state,error FROM jobs WHERE kind='library.convert'",
        );
        if (job?.state === "failed") throw new Error(job.error);
        expect(job?.state).toBe("done");
      },
      { timeout: 5000, interval: 5 },
    );
    expect(kernel.library.document(docId).status).toBe("ready");
    const described = await api.library.doc.describe({ doc: docId });
    expect(described.document.title).toBe("A document");
    const novelId = db.get<{ id: string }>(
      "SELECT id FROM library_documents WHERE json_extract(body,'$.title')='Downloaded novel'",
    )!.id;
    await vi.waitFor(
      () => expect(kernel.library.document(novelId).status).toBe("ready"),
      { timeout: 5000, interval: 5 },
    );
    const opened = await api.library.doc.open({ doc: novelId });
    expect(opened.manifest.kind).toBe("flow");
    expect(opened.document.title).toBe("Downloaded novel");
    // Legacy learning data and the learning gate are retired, not imported.
    expect(login.user.features).not.toContain("learning");
    expect(login.user.features).toContain("post_images");
    expect(
      db.get<{ n: number }>(
        "SELECT count(*) n FROM sqlite_master WHERE name LIKE 'learning_%'",
      )!.n,
    ).toBe(0);
  } finally {
    client.stop();
    await kernel.close();
    db.close();
  }
}, 15000);

it("resumes after an interrupted committed batch without duplicating users", async () => {
  const f = await fixture();
  const cli = fileURLToPath(new URL("../bin/migrate.mjs", import.meta.url));
  const interrupted = spawnSync(
    process.execPath,
    [cli, "run", "--source", f.source, "--target", f.target],
    {
      env: { ...process.env, TALOS_MIGRATE_STOP_AFTER_BATCH: "1" },
      encoding: "utf8",
    },
  );
  expect(interrupted.status).toBe(1);
  await main(["run", "--source", f.source, "--target", f.target, "--resume"]);
  const db = new Db(join(f.target, "talos.db"));
  try {
    expect(db.get<{ n: number }>("SELECT count(*) n FROM users")?.n).toBe(1);
    expect(
      db.get<{ n: number }>(
        "SELECT count(*) n FROM migration_map WHERE entity='users'",
      )?.n,
    ).toBe(1);
  } finally {
    db.close();
  }
}, 15000);

it("reports duplicate handles, an orphan and a missing source blob", async () => {
  const f = await fixture();
  const db = new DatabaseSync(f.source);
  db.exec("PRAGMA foreign_keys=OFF");
  db.prepare("INSERT INTO users(id,handle,username) VALUES(?,?,?)").run(
    "99999999-9999-4999-8999-999999999999",
    "ALICE",
    "Second",
  );
  db.prepare("INSERT INTO group_members(group_id,user_id) VALUES(?,?)").run(
    group,
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  db.prepare(
    "INSERT INTO articles(id,user_id,title,provider_json) VALUES(?,?,?,?)",
  ).run(
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    alice,
    "Missing PDF",
    JSON.stringify({
      type: "bundle",
      source_file: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      archive_file: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      source_mime: "application/pdf",
      source_bytes: 1,
      archive_bytes: 1,
      items: 1,
    }),
  );
  db.close();
  await main(["run", "--source", f.source, "--target", f.target]);
  const target = new Db(join(f.target, "talos.db"));
  try {
    expect(
      target
        .all<{ handle: string }>("SELECT handle FROM users")
        .map((x) => x.handle)
        .sort(),
    ).toEqual(["ALICE_1", "alice"]);
    expect(
      target
        .all<{ reason: string }>("SELECT reason FROM migration_issues")
        .map((x) => x.reason)
        .join(" "),
    ).toMatch(/orphan membership/);
    expect(
      target
        .all<{ reason: string }>("SELECT reason FROM migration_issues")
        .map((x) => x.reason)
        .join(" "),
    ).toMatch(/ENOENT/);
  } finally {
    target.close();
  }
}, 15000);

it("bounds previews while retaining long post bodies and decodes malformed legacy text", async () => {
  const f = await fixture();
  const db = new DatabaseSync(f.source);
  const long = "长".repeat(20_000);
  db.prepare("UPDATE posts SET brief=? WHERE id=?").run(long, post);
  db.exec("UPDATE users SET username=CAST(X'80' AS TEXT) WHERE handle='alice'");
  db.close();
  await main(["run", "--source", f.source, "--target", f.target]);
  const target = new Db(join(f.target, "talos.db"));
  try {
    const migrated = target.get<{ body: string; data: string }>(
      "SELECT body,data FROM chat_posts",
    );
    expect(migrated?.body).toBe(long);
    const postData = JSON.parse(migrated!.data) as {
      preview: string;
      bodyLength: number;
    };
    expect(postData.preview.length).toBe(1000);
    expect(postData.bodyLength).toBe(20_000);
    expect(
      target.get<{ name: string }>("SELECT name FROM users")?.name,
    ).toContain("�");
  } finally {
    target.close();
  }
}, 15000);

it("streams a legacy image into the objects ledger and regenerates its thumbnail", async () => {
  const f = await fixture();
  const blobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const imageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const bytes = await readFile(
    new URL(
      "../../../packages/server/stickers/akendfield2/a_05.png",
      import.meta.url,
    ),
  );
  const blobDir = join(f.dir, "storage", "objects", "aa", "aa");
  await mkdir(blobDir, { recursive: true });
  await writeFile(join(blobDir, blobId), bytes);
  const db = new DatabaseSync(f.source);
  db.prepare(
    "INSERT INTO post_images(id,post_id,blob_id,mime,bytes,width,height,sha256) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    imageId,
    post,
    blobId,
    "image/png",
    bytes.length,
    1,
    1,
    createHash("sha256").update(bytes).digest("hex"),
  );
  db.close();
  await main(["run", "--source", f.source, "--target", f.target]);
  const target = new Db(join(f.target, "talos.db"));
  try {
    const data = JSON.parse(
      target.get<{ data: string }>("SELECT data FROM chat_posts")!.data,
    ) as {
      kind: string;
      image: { original: { rid: string }; thumbnail: { rid: string } };
    };
    expect(
      data.kind,
      target
        .all<{ reason: string }>("SELECT reason FROM migration_issues")
        .map((x) => x.reason)
        .join("; "),
    ).toBe("image");
    expect(
      target.get<{ n: number }>(
        "SELECT count(*) n FROM object_refs WHERE owner_kind=?",
        "chat-post",
      )?.n,
    ).toBe(2);
    expect(data.image.original.rid).toMatch(/^[a-f0-9]{64}$/);
    expect(data.image.thumbnail.rid).toMatch(/^[a-f0-9]{64}$/);
  } finally {
    target.close();
  }
}, 15000);

it("imports real media rows and audio bytes into the module ledger", async () => {
  const f = await fixture();
  const track = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const blob = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const blobDir = join(f.dir, "storage", "objects", "dd", "dd");
  await mkdir(blobDir, { recursive: true });
  await writeFile(join(blobDir, blob), Buffer.from("audio fixture"));
  const db = new DatabaseSync(f.source);
  db.prepare(
    "INSERT INTO media_tracks(id,source,provider_id,canonical_url,title,duration_ms) VALUES(?,?,?,?,?,?)",
  ).run(track, "youtube", "track", "https://example.invalid", "Song", 1000);
  db.prepare(
    "INSERT INTO media_assets(track_id,kind,state,blob_id,mime,bytes) VALUES(?,?,?,?,?,?)",
  ).run(track, "audio", "ready", blob, "audio/mpeg", 13);
  db.close();
  await main(["run", "--source", f.source, "--target", f.target]);
  const target = new Db(join(f.target, "talos.db"));
  try {
    const track = target.get<{ object_id: string }>(
      "SELECT object_id FROM media_tracks",
    );
    expect(track?.object_id).toMatch(/^[a-f0-9]{64}$/);
    expect(
      target.get<{ n: number }>(
        "SELECT count(*) n FROM object_refs WHERE owner_kind='media.audio'",
      )?.n,
    ).toBe(1);
    expect(
      target.get(
        "SELECT 1 FROM sqlite_master WHERE name='migration_media_rows'",
      ),
    ).toBeUndefined();
  } finally {
    target.close();
  }
}, 15000);

it("maps legacy system groups to the seeded target and restores hierarchy", async () => {
  const f = await fixture();
  const db = new DatabaseSync(f.source);
  db.prepare("INSERT INTO config VALUES(?,?)").run("whitelist_enabled", "1");
  db.prepare(
    "INSERT INTO groups(id,conv_id,handle,name,type) VALUES(?,?,?,?,?)",
  ).run("wild", "group:wild", "wild", "Legacy wild", "wild");
  db.prepare("UPDATE groups SET parent_group_id=? WHERE id=?").run(
    "wild",
    group,
  );
  db.close();
  await main(["run", "--source", f.source, "--target", f.target]);
  const target = new Db(join(f.target, "talos.db"));
  try {
    const wild = target.get<{ id: string }>(
      "SELECT id FROM community_conversations WHERE type='wild'",
    )!;
    expect(
      target.get<{ new_id: string }>(
        "SELECT new_id FROM migration_map WHERE entity='groups' AND legacy_id='wild'",
      )?.new_id,
    ).toBe(wild.id);
    const normal = target.get<{ parent: string }>(
      "SELECT parent FROM community_conversations WHERE type='normal'",
    );
    expect(normal?.parent).toBe(wild.id);
    expect(
      target.get<{ whitelist: number }>(
        "SELECT whitelist FROM identity_policy WHERE id=1",
      )?.whitelist,
    ).toBe(1);
  } finally {
    target.close();
  }
}, 15000);

it("preserves a sticker post reference through the seeded target catalog", async () => {
  const f = await fixture();
  const db = new DatabaseSync(f.source);
  db.prepare("UPDATE posts SET brief=?,content_json=? WHERE id=?").run(
    "[贴纸] 12F",
    JSON.stringify({
      type: "sticker",
      sticker_pack: "akavatar",
      sticker_id: "12F",
    }),
    post,
  );
  db.close();
  await main(["run", "--source", f.source, "--target", f.target]);
  const target = new Db(join(f.target, "talos.db"));
  try {
    const data = JSON.parse(
      target.get<{ data: string }>("SELECT data FROM chat_posts")!.data,
    ) as { kind: string; sticker: { id: string } };
    expect(data.kind).toBe("sticker");
    expect(data.sticker.id).toBe("akavatar:12F");
    expect(
      target.get<{ done: number }>("SELECT done FROM migration_sticker_refs")
        ?.done,
    ).toBe(1);
  } finally {
    target.close();
  }
}, 120_000);

it("streams a legacy AI workspace ZIP into usable per-file records", async () => {
  const f = await fixture();
  const blob = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const entry = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const data = Buffer.from("# Legacy notes\nhello");
  const manifest = {
    format: "classapp-object-tree",
    version: 1,
    revision: 1,
    entries: [
      {
        id: entry,
        path: "notes.md",
        mime: "text/markdown",
        size: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
    ],
  };
  const archive = zipSync(
    {
      "manifest.json": Buffer.from(JSON.stringify(manifest)),
      [`objects/${entry}`]: data,
    },
    { level: 6 },
  );
  const blobDir = join(f.dir, "storage", "objects", "ee", "ee");
  await mkdir(blobDir, { recursive: true });
  await writeFile(join(blobDir, blob), archive);
  const db = new DatabaseSync(f.source);
  db.prepare("INSERT INTO ai_workspaces(user_id,blob_id) VALUES(?,?)").run(
    alice,
    blob,
  );
  db.close();
  await main(["run", "--source", f.source, "--target", f.target]);
  const target = new Db(join(f.target, "talos.db"));
  if (!target.get("SELECT 1 FROM ai_files"))
    throw new Error(
      JSON.stringify(target.all("SELECT * FROM migration_issues")),
    );
  const kernel = createKernel({
    db: target,
    store: createFsObjectStore({ root: f.target }),
    build: "test",
  });
  const ready = deferred<void>();
  const client = new LinkClient({
    connect: async () => {
      const pair = createMemoryCarrierPair();
      kernel.host.link.accept(pair.b, {});
      return pair.a;
    },
    hello: () => ({ v: 1, build: "test", device: null, lang: "zh-CN" }),
  });
  client.onWelcome(() => ready.resolve());
  client.start();
  await ready.promise;
  try {
    const api = createApi(client.call.bind(client));
    await api.auth.device.register({});
    await api.auth.login({ pin: "123456" });
    const listing = await api.ai.workspace.list({});
    expect(listing.map((x) => x.path)).toContain("notes.md");
    const read = await api.ai.workspace.read({ path: "notes.md" });
    expect(read.content).toBe(data.toString());
    expect(
      target.get<{ n: number }>(
        "SELECT count(*) n FROM migration_workspace_files",
      )?.n,
    ).toBe(1);
  } finally {
    client.stop();
    await kernel.close();
    target.close();
  }
}, 15000);

it("rejects resume when the legacy database changed in place", async () => {
  const f = await fixture();
  const cli = fileURLToPath(new URL("../bin/migrate.mjs", import.meta.url));
  const stopped = spawnSync(
    process.execPath,
    [cli, "run", "--source", f.source, "--target", f.target],
    {
      env: { ...process.env, TALOS_MIGRATE_STOP_AFTER_BATCH: "1" },
      encoding: "utf8",
    },
  );
  expect(stopped.status).toBe(1);
  const db = new DatabaseSync(f.source);
  db.prepare("UPDATE users SET username=? WHERE id=?").run("Changed", alice);
  db.close();
  await expect(
    main(["run", "--source", f.source, "--target", f.target, "--resume"]),
  ).rejects.toThrow(/Resume source differs/);
}, 15000);

it("rejects corrupted document bodies, audio objects, target counts and exact balances", async () => {
  const f = await completionFixture();
  await main(["run", "--source", f.source, "--target", f.target]);
  const db = new Db(join(f.target, "talos.db"));
  const object = db.get<{ object_id: string }>(
    "SELECT object_id FROM media_tracks",
  )!.object_id;
  const store = createFsObjectStore({ root: f.target });
  await writeFile(store.localPath(object)!, Buffer.from("corrupt audio"));
  db.run("UPDATE migration_text_segments SET content='changed'");
  const doc = db.get<{ source: string }>(
    "SELECT source FROM library_documents WHERE json_extract(body,'$.title')='A document'",
  )!.source;
  await writeFile(store.localPath(doc)!, Buffer.from("changed body"));
  db.run("UPDATE ai_accounts SET topup=topup+1");
  db.run("DELETE FROM media_playlists");
  db.close();
  const output = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  const previous = process.exitCode;
  try {
    process.exitCode = 0;
    await main(["verify", "--source", f.source, "--target", f.target]);
    const result = JSON.parse(
      String(output.mock.calls[output.mock.calls.length - 1]?.[0]),
    ) as { mismatches: string[] };
    expect(
      result.mismatches.some(
        (x) => x.includes("articles/") && x.includes("blob"),
      ),
    ).toBe(true);
    expect(
      result.mismatches.some(
        (x) => x.includes("media_assets/") && x.includes("blob"),
      ),
    ).toBe(true);
    expect(
      result.mismatches.some((x) => x.includes("media_lists: target entities")),
    ).toBe(true);
    expect(
      result.mismatches.some((x) => x.includes("AI balance sum differs")),
    ).toBe(true);
    expect(process.exitCode).toBe(1);
  } finally {
    output.mockRestore();
    process.exitCode = previous;
  }
}, 15000);

it("records a rejected legacy audio checksum and never attaches corrupt bytes", async () => {
  const f = await completionFixture(),
    source = new DatabaseSync(f.source);
  source.prepare("UPDATE media_assets SET sha256=?").run("0".repeat(64));
  source.close();
  await main(["run", "--source", f.source, "--target", f.target]);
  const db = new Db(join(f.target, "talos.db"));
  try {
    expect(
      db.get<{ object_id: string | null }>("SELECT object_id FROM media_tracks")
        ?.object_id,
    ).toBeNull();
    expect(
      db.get("SELECT 1 FROM migration_issues WHERE entity='media_assets'"),
    ).toBeDefined();
    expect(
      db.get("SELECT 1 FROM object_refs WHERE owner_kind='media.audio'"),
    ).toBeUndefined();
  } finally {
    db.close();
  }
}, 15000);

it("keeps balances and reservation release notes exact through resume", async () => {
  const f = await completionFixture();
  await main(["run", "--source", f.source, "--target", f.target]);
  await main(["run", "--resume", "--source", f.source, "--target", f.target]);
  const db = new Db(join(f.target, "talos.db"));
  try {
    expect(
      db.get<{ total: number }>("SELECT sum(topup) total FROM ai_accounts")
        ?.total,
    ).toBe(123456796);
    expect(
      db.get<{ total: number }>("SELECT sum(amount) total FROM ai_ledger")
        ?.total,
    ).toBe(123456789);
    expect(
      db.get<{ n: number }>(
        "SELECT count(*) n FROM ai_ledger WHERE kind='release' AND amount=0",
      )?.n,
    ).toBe(2);
    expect(
      db.get<{ n: number }>("SELECT count(*) n FROM media_tracks")?.n,
    ).toBe(1);
    expect(db.get<{ n: number }>("SELECT count(*) n FROM ai_files")?.n).toBe(1);
  } finally {
    db.close();
  }
}, 15000);

it("preserves group sharing, limits mixed delegation, and does not turn possession into authority", async () => {
  const f = await completionFixture(),
    source = new DatabaseSync(f.source);
  source
    .prepare("UPDATE access_bindings SET grants_json=? WHERE principal_id=?")
    .run(
      '[{"mode":"readwrite","shareable":false},{"mode":"read","shareable":true}]',
      alice,
    );
  source
    .prepare(
      "INSERT INTO access_bindings(resource_kind,resource_id,principal_kind,principal_id,grants_json) VALUES('booklist',?,'group',?,?)",
    )
    .run(booklist, group, '[{"mode":"read","shareable":true}]');
  source
    .prepare(
      "INSERT INTO resource_possession(user_id,resource_kind,resource_id,capability,source_kind,expires_at_ms) VALUES(?,'article',?,'c1.legacy.token','upload',9999999999999)",
    )
    .run(bob, article);
  source.close();
  await main(["run", "--source", f.source, "--target", f.target]);
  const db = new Db(join(f.target, "talos.db")),
    kernel = createKernel({
      db,
      store: createFsObjectStore({ root: f.target }),
      build: "test",
      printRootPin: () => {},
    });
  try {
    const uid = db.get<{ new_id: string }>(
      "SELECT new_id FROM migration_map WHERE entity='users' AND legacy_id=?",
      alice,
    )!.new_id;
    const coll = db.get<{ new_id: string }>(
      "SELECT new_id FROM migration_map WHERE entity='booklists'",
    )!.new_id;
    const gid = db.get<{ new_id: string }>(
      "SELECT new_id FROM migration_map WHERE entity='groups'",
    )!.new_id;
    expect(kernel.library.repo.delegation(coll, "user", uid)).toBe(false);
    expect(kernel.library.repo.delegation(coll, "group", gid)).toBe(true);
    expect(
      kernel.authority.can(uid, "resource.write", { id: `coll:${coll}` }),
    ).toBe(true);
    expect(
      db.get(
        "SELECT 1 FROM migration_issues WHERE reason LIKE 'Read delegation%'",
      ),
    ).toBeDefined();
    expect(
      db.get(
        "SELECT 1 FROM migration_issues WHERE entity='resource_possession'",
      ),
    ).toBeDefined();
    expect(
      db.get("SELECT 1 FROM authority_grants WHERE resource LIKE 'article:%'"),
    ).toBeUndefined();
  } finally {
    await kernel.close();
    db.close();
  }
}, 15000);

it("reports missing attachment files and detects workspace content corruption", async () => {
  const f = await completionFixture(),
    source = new DatabaseSync(f.source);
  source
    .prepare("UPDATE ai_messages SET attachments_json=?")
    .run(
      '[{"path":"missing.png","name":"missing","mime":"image/png","size":1}]',
    );
  source.close();
  await main(["run", "--source", f.source, "--target", f.target]);
  const db = new Db(join(f.target, "talos.db"));
  expect(
    db.get(
      "SELECT 1 FROM migration_issues WHERE entity='ai_messages' AND reason LIKE '%missing.png%'",
    ),
  ).toBeDefined();
  db.run("UPDATE ai_files SET bytes=?", Buffer.from("changed"));
  db.close();
  const previous = process.exitCode,
    output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    process.exitCode = 0;
    await main(["verify", "--source", f.source, "--target", f.target]);
    expect(
      String(output.mock.calls[output.mock.calls.length - 1]?.[0]),
    ).toContain("ai_files/");
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = previous;
    output.mockRestore();
  }
}, 15000);

it("adapts v25 bookmarks, group libraries and owned queues without changing the source", async () => {
  const f = await fixture();
  const source = new DatabaseSync(f.source);
  source.exec(`
    INSERT INTO config VALUES('schema_version','25');
    DROP TABLE access_bindings;
    DROP TABLE group_booklists;
    DROP TABLE booklist_items;
    DROP TABLE booklists;
    DROP TABLE user_favorites;
    DROP TABLE user_queues;
    ALTER TABLE articles ADD COLUMN group_id TEXT;
    ALTER TABLE media_lists ADD COLUMN owner_user_id TEXT;
    CREATE TABLE article_bookmarks(user_id TEXT,article_id TEXT,bookmarked INTEGER,updated_at_ms INTEGER,created_at TEXT);
  `);
  source.prepare("UPDATE articles SET group_id=?").run(group);
  source
    .prepare("INSERT INTO article_bookmarks VALUES(?,?,1,1234,'2020-01-01')")
    .run(alice, article);
  source
    .prepare(
      "INSERT INTO media_lists(id,kind,title,owner_user_id) VALUES('queue','queue','Personal queue',?)",
    )
    .run(alice);
  const before = source
    .prepare("SELECT sql FROM sqlite_master ORDER BY name")
    .all();
  source.close();
  const sourceBytes = await readFile(f.source);
  const output = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  const previous = process.exitCode;
  try {
    await main(["run", "--source", f.source, "--target", f.target]);
    process.exitCode = 0;
    await main(["verify", "--source", f.source, "--target", f.target]);
    expect(
      JSON.parse(String(output.mock.calls.at(-1)?.[0])).mismatches,
    ).toEqual([]);
    expect(process.exitCode).toBe(1); // Group-only ownership requires a reported fallback user.
    const db = new Db(join(f.target, "talos.db"));
    expect(
      db.get<{ n: number }>("SELECT count(*) n FROM library_items")!.n,
    ).toBe(1);
    expect(
      db.get<{ n: number }>(
        "SELECT count(*) n FROM library_states WHERE json_extract(body,'$.favourite.v')=1",
      )!.n,
    ).toBe(1);
    expect(
      db.get<{ n: number }>("SELECT count(*) n FROM media_user_states")!.n,
    ).toBe(1);
    expect(
      db.get("SELECT 1 FROM migration_issues WHERE entity='access_bindings'"),
    ).toBeUndefined();
    expect(
      db.get(
        "SELECT 1 FROM authority_grants WHERE principal_type='group' AND level='own'",
      ),
    ).toBeDefined();
    db.close();
    await main(["run", "--source", f.source, "--target", f.target, "--resume"]);
    const resumed = new Db(join(f.target, "talos.db"));
    try {
      // Resume must not run previously queued conversions in the offline importer.
      expect(
        resumed.get<{ n: number }>(
          "SELECT count(*) n FROM jobs WHERE kind='library.convert' AND state='queued'",
        )!.n,
      ).toBeGreaterThan(0);
      expect(
        resumed.get<{ n: number }>(
          "SELECT count(*) n FROM jobs WHERE attempts>0",
        )!.n,
      ).toBe(0);
    } finally {
      resumed.close();
    }
    const unchanged = new DatabaseSync(f.source, { readOnly: true });
    expect(
      unchanged.prepare("SELECT sql FROM sqlite_master ORDER BY name").all(),
    ).toEqual(before);
    unchanged.close();
    expect(await readFile(f.source)).toEqual(sourceBytes);
  } finally {
    process.exitCode = previous;
    output.mockRestore();
  }
}, 15000);

it("rejects unsupported versions and v25 binary storage before creating a target", async () => {
  const f = await fixture();
  const source = new DatabaseSync(f.source);
  source.exec("INSERT INTO config VALUES('schema_version','24')");
  await expect(main(["inspect", "--source", f.source])).rejects.toThrow(
    "Supported legacy schema",
  );
  source.exec("UPDATE config SET value='25' WHERE key='schema_version'");
  source
    .prepare("UPDATE articles SET provider_json=?")
    .run('{"type":"bundle","source_file":"old-path"}');
  source.close();
  await expect(
    main(["run", "--source", f.source, "--target", f.target]),
  ).rejects.toThrow("separate recovery");
  await expect(stat(f.target)).rejects.toMatchObject({ code: "ENOENT" });
});

it("publishes decodable reading and chat projections and detects corruption", async () => {
  const { libraryStateSchema } = await import("@talos/contract");
  const { verifyProjections } = await import("./target/projections.ts");
  const f = await completionFixture();
  const source = new DatabaseSync(f.source);
  source.exec(
    "CREATE TABLE convs_user(user_id TEXT,conv_id TEXT,last_read_post_id TEXT); CREATE TABLE article_read_progress(user_id TEXT,article_id TEXT,offset INTEGER,total_read_seconds INTEGER,updated_at_ms INTEGER)",
  );
  source
    .prepare("INSERT INTO article_read_progress VALUES(?,?,12,45,1000)")
    .run(alice, article);
  source
    .prepare("INSERT INTO convs_user VALUES(?,?,?)")
    .run(alice, `group:${group}`, post);
  source.close();
  await main(["run", "--source", f.source, "--target", f.target]);
  const db = new Db(join(f.target, "talos.db"));
  try {
    expect(verifyProjections(db)).toEqual([]);
    for (const row of db.all<{ body: string }>(
      "SELECT body FROM library_states",
    ))
      expect(libraryStateSchema.safeParse(JSON.parse(row.body)).success).toBe(
        true,
      );
    const state = JSON.parse(
      db.get<{ data: string }>(
        "SELECT data FROM chat_states WHERE conversation=?",
        legacyUlid("groups", group),
      )!.data,
    ) as { lastPost: { authorName: string; preview: string } };
    expect(state.lastPost.authorName).toBe("Alice");
    expect(state.lastPost.preview).toBe("hello");
    db.run("UPDATE chat_posts SET data=json_set(data,'$.authorName','')");
    db.run(
      "UPDATE library_states SET body=json_set(body,'$.seconds',json('{\"legacy\":1}'))",
    );
    const failures = verifyProjections(db);
    expect(failures.some((m) => m.startsWith("chat_posts:"))).toBe(true);
    expect(failures.some((m) => m.startsWith("library_states:"))).toBe(true);
  } finally {
    db.close();
  }
}, 15000);

it("preserves legacy users.banned_until UTC deadlines and clears expired bans", async () => {
  const f = await fixture();
  const source = new DatabaseSync(f.source);
  source
    .prepare("UPDATE users SET banned_until=? WHERE id=?")
    .run("2099-01-02 03:04:05", alice);
  source
    .prepare(
      "INSERT INTO users(id,handle,username,banned_until) VALUES(?,?,?,?)",
    )
    .run("expired-user", "expired", "Expired", "2000-01-01 00:00:00");
  source.close();
  await main(["run", "--source", f.source, "--target", f.target]);
  const db = new Db(join(f.target, "talos.db"));
  try {
    expect(
      db.get("SELECT banned,banned_until FROM users WHERE handle='alice'"),
    ).toEqual({ banned: 1, banned_until: Date.parse("2099-01-02T03:04:05Z") });
    expect(
      db.get("SELECT banned,banned_until FROM users WHERE handle='expired'"),
    ).toEqual({ banned: 0, banned_until: null });
  } finally {
    db.close();
  }
});

it("renumbers interleaved global legacy sequences densely per conversation and maps read marks", async () => {
  const f = await completionFixture();
  const source = new DatabaseSync(f.source);
  const group2 = "77777777-7777-4777-8777-777777777771";
  source
    .prepare("INSERT INTO groups(id,conv_id,handle,name) VALUES(?,?,?,?)")
    .run(group2, `group:${group2}`, "other", "Other");
  source.exec(
    "CREATE TABLE convs_user(user_id TEXT,conv_id TEXT,last_read_post_id TEXT)",
  );
  const add = source.prepare(
    "INSERT INTO posts(id,conv_id,author_id,brief,content_json) VALUES(?,?,?,?,?)",
  );
  const json = '{"type":"text","text_same_as_brief":true}';
  // Fixture post is global sequence 1 in `group`; the rest interleave with sparse gaps.
  add.run("p-b1", `group:${group2}`, alice, "b1", json);
  add.run("p-a2", `group:${group}`, alice, "a2", json);
  add.run("p-orphan", "group:missing", alice, "x", json);
  add.run("p-b2", `group:${group2}`, alice, "b2", json);
  add.run("p-a3", `group:${group}`, alice, "a3", json);
  const mark = source.prepare("INSERT INTO convs_user VALUES(?,?,?)");
  mark.run(alice, `group:${group}`, "p-a2");
  mark.run(alice, `group:${group2}`, "p-b2");
  source
    .prepare(
      "INSERT INTO ai_messages(id,conversation_id,role,content,status) VALUES(?,?,?,?,?)",
    )
    .run("m2", conversation, "assistant", "hi", "completed");
  source
    .prepare(
      "UPDATE ai_conversations SET last_assistant_sequence=(SELECT max(sequence) FROM ai_messages)",
    )
    .run();
  source.close();
  await main(["run", "--source", f.source, "--target", f.target]);
  const db = new Db(join(f.target, "talos.db"));
  try {
    const seqs = (conv: string) =>
      db
        .all<{ seq: number }>(
          "SELECT seq FROM chat_posts WHERE conversation=? ORDER BY seq",
          legacyUlid("groups", conv),
        )
        .map((r) => r.seq);
    expect(seqs(group)).toEqual([1, 2, 3]);
    expect(seqs(group2)).toEqual([1, 2]);
    const state = (conv: string) =>
      JSON.parse(
        db.get<{ data: string }>(
          "SELECT data FROM chat_states WHERE conversation=?",
          legacyUlid("groups", conv),
        )!.data,
      ) as { readSeq: number; lastSeq: number };
    expect(state(group)).toMatchObject({ readSeq: 2, lastSeq: 3 });
    expect(state(group2)).toMatchObject({ readSeq: 2, lastSeq: 2 });
    expect(
      db
        .all<{ seq: number }>("SELECT seq FROM ai_messages ORDER BY seq")
        .map((r) => r.seq),
    ).toEqual([1, 2]);
    expect(
      JSON.parse(
        db.get<{ data: string }>(
          "SELECT data FROM ai_rows WHERE type='aiConversation'",
        )!.data,
      ),
    ).toMatchObject({ lastSeq: 2 });
    expect(
      db.get("SELECT 1 FROM migration_issues WHERE entity='posts'"),
    ).toBeTruthy();
  } finally {
    db.close();
  }
});
