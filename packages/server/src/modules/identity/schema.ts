import type { Migration } from "../../kernel/persistence/db.ts";
export const identityMigrations: readonly Migration[] = [
  {
    n: 1,
    up(db) {
      db.exec(`
CREATE TABLE secrets(name TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
CREATE TABLE users(id TEXT PRIMARY KEY,handle TEXT NOT NULL UNIQUE,name TEXT NOT NULL,roles TEXT NOT NULL CHECK(json_valid(roles)),features TEXT NOT NULL CHECK(json_valid(features)),banned INTEGER NOT NULL DEFAULT 0 CHECK(banned IN (0,1)),created INTEGER NOT NULL,rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))) STRICT;
CREATE INDEX users_rev ON users(id,rev);
CREATE TABLE user_pins(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id)) STRICT;
CREATE TABLE devices(id TEXT PRIMARY KEY,label TEXT NOT NULL,last_seen INTEGER NOT NULL,failures INTEGER NOT NULL DEFAULT 0,blocked_until INTEGER NOT NULL DEFAULT 0,whitelisted INTEGER NOT NULL DEFAULT 0 CHECK(whitelisted IN (0,1)),bound_user TEXT REFERENCES users(id),locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1))) STRICT;
CREATE TABLE sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),device_id TEXT NOT NULL REFERENCES devices(id),created INTEGER NOT NULL,expires INTEGER NOT NULL,UNIQUE(user_id,device_id)) STRICT;
CREATE INDEX sessions_expiry ON sessions(expires);
CREATE TABLE invitations(id TEXT PRIMARY KEY,created INTEGER NOT NULL,expires INTEGER NOT NULL,claimed_by TEXT REFERENCES users(id)) STRICT;
`);
    },
  },
  {
    n: 2,
    up(db) {
      db.exec(`
ALTER TABLE user_pins ADD COLUMN salt TEXT;
ALTER TABLE user_pins ADD COLUMN verifier TEXT;
ALTER TABLE devices ADD COLUMN banned INTEGER NOT NULL DEFAULT 0 CHECK(banned IN (0,1));
ALTER TABLE invitations ADD COLUMN pin_hash TEXT;
ALTER TABLE invitations ADD COLUMN salt TEXT;
ALTER TABLE invitations ADD COLUMN verifier TEXT;
ALTER TABLE invitations ADD COLUMN token_hash TEXT;
ALTER TABLE invitations ADD COLUMN device_id TEXT REFERENCES devices(id);
ALTER TABLE invitations ADD COLUMN token_expires INTEGER;
CREATE UNIQUE INDEX invitations_pin ON invitations(pin_hash);
CREATE UNIQUE INDEX invitations_token ON invitations(token_hash);
CREATE TABLE identity_policy(id INTEGER PRIMARY KEY CHECK(id=1),whitelist INTEGER NOT NULL DEFAULT 0 CHECK(whitelist IN (0,1)),system_lock INTEGER NOT NULL DEFAULT 0 CHECK(system_lock IN (0,1)),idle_lock INTEGER NOT NULL DEFAULT 0 CHECK(idle_lock IN (0,1))) STRICT;
INSERT INTO identity_policy(id) VALUES(1);
CREATE TABLE identity_ip_throttle(ip TEXT PRIMARY KEY,failures INTEGER NOT NULL,blocked_until INTEGER NOT NULL) STRICT;
`);
    },
  },
  {
    n: 3,
    up(db) {
      db.exec(
        "ALTER TABLE users ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 0",
      );
    },
  },
  {
    n: 4,
    up(db) {
      db.exec(
        "ALTER TABLE devices ADD COLUMN persistent INTEGER NOT NULL DEFAULT 1 CHECK(persistent IN (0,1)); ALTER TABLE devices ADD COLUMN user_agent_hash TEXT; ALTER TABLE devices ADD COLUMN ip_hash TEXT; ALTER TABLE identity_policy ADD COLUMN identity_signals TEXT NOT NULL DEFAULT '[\"clientId\"]' CHECK(json_valid(identity_signals));",
      );
    },
  },
  {
    n: 5,
    up(db) {
      db.exec("ALTER TABLE users ADD COLUMN banned_until INTEGER");
    },
  },
  {
    n: 6,
    up(db) {
      db.exec(
        "ALTER TABLE users ADD COLUMN purging INTEGER NOT NULL DEFAULT 0 CHECK(purging IN (0,1))",
      );
    },
  },
];
