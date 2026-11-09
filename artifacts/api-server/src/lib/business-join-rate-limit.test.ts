import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { joinBusinessByCodeWithClient } from "./business-tenancy";

const WINDOW_MS = 15 * 60 * 1000;
const HASH_SECRET = "test-only-hash-secret";

class FakeRegistryDatabase {
  now = 1_800_000_000_000;
  attempts = new Map<string, number[]>();
  businesses = new Map<string, { id: string; name: string }>();

  createClient() {
    return new FakeRegistryClient(this);
  }
}

class FakeRegistryClient {
  constructor(private readonly database: FakeRegistryDatabase) {}

  async query(sqlText: string, values: unknown[] = []) {
    const sql = sqlText.replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };

    if (sql.startsWith("SELECT GREATEST")) {
      const keys = values[0] as string[];
      const rows = keys.flatMap((key) => {
        const recentAttempts = (this.database.attempts.get(key) ?? [])
          .filter((timestamp) => timestamp > this.database.now - WINDOW_MS);
        if (recentAttempts.length < 5) return [];
        return [{
          retry_after_seconds: Math.max(
            1,
            Math.ceil((Math.min(...recentAttempts) + WINDOW_MS - this.database.now) / 1000),
          ),
        }];
      });
      return { rows };
    }

    if (sql.startsWith("SELECT id::text, name FROM public.businesses")) {
      const found = this.database.businesses.get(String(values[0]));
      return { rows: found ? [{ id: found.id, name: found.name }] : [] };
    }

    if (sql.startsWith("WITH expired AS")) {
      for (const [key, timestamps] of this.database.attempts) {
        const recent = timestamps.filter((timestamp) => timestamp > this.database.now - WINDOW_MS);
        if (recent.length) this.database.attempts.set(key, recent);
        else this.database.attempts.delete(key);
      }
      for (let index = 1; index < values.length; index += 2) {
        const key = String(values[index]);
        this.database.attempts.set(key, [
          ...(this.database.attempts.get(key) ?? []),
          this.database.now,
        ]);
      }
      return { rows: [] };
    }

    if (sql.startsWith("INSERT INTO public.business_join_attempts")) {
      const key = String(values[1]);
      this.database.attempts.set(key, [
        ...(this.database.attempts.get(key) ?? []),
        this.database.now,
      ]);
      return { rows: [] };
    }

    if (sql.includes("FROM public.business_join_attempts")) {
      throw new Error(`Unexpected join-attempt SQL in fake registry client: ${sql}`);
    }

    if (
      sql.startsWith("INSERT INTO public.business_users") ||
      sql.startsWith("INSERT INTO public.business_memberships")
    ) {
      return { rows: [] };
    }

    throw new Error(`Unexpected SQL in fake registry client: ${sql}`);
  }
}

const codeHash = (code: string) =>
  createHash("sha256").update(code, "utf8").digest("hex");

function join(client: FakeRegistryClient, overrides: Partial<{
  userId: string;
  email: string;
  code: string;
  ipAddress: string;
}> = {}) {
  return joinBusinessByCodeWithClient(client, {
    userId: "clerk-user-123",
    email: "person@example.com",
    code: "1111111111",
    ipAddress: "203.0.113.8",
    ...overrides,
  }, HASH_SECRET);
}

test("the sixth wrong join-code attempt is blocked across registry clients", async () => {
  const database = new FakeRegistryDatabase();
  const firstInstance = database.createClient();
  const secondInstance = database.createClient();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await join(attempt % 2 === 0 ? firstInstance : secondInstance);
    assert.equal(result.kind, "invalid-code");
  }

  const blocked = await join(secondInstance);
  assert.equal(blocked.kind, "rate-limited");
  if (blocked.kind === "rate-limited") {
    assert.ok(blocked.retryAfterSeconds > 0);
    assert.ok(blocked.retryAfterSeconds <= 15 * 60);
  }
  assert.equal(database.attempts.size, 2);
  for (const key of database.attempts.keys()) {
    assert.equal(key.includes("clerk-user-123"), false);
    assert.equal(key.includes("203.0.113.8"), false);
  }
});

test("a valid code joins without writing or cleaning failed-attempt counters", async () => {
  const database = new FakeRegistryDatabase();
  const code = "9876543210";
  database.businesses.set(codeHash(code), { id: "business-1", name: "Cơ sở thử" });
  database.attempts.set("old-expired-key", [database.now - WINDOW_MS - 1]);

  const result = await join(database.createClient(), { code });
  assert.deepEqual(result, {
    kind: "joined",
    business: { id: "business-1", name: "Cơ sở thử", role: "employee" },
  });
  assert.equal(database.attempts.size, 1);
  assert.equal(database.attempts.has("old-expired-key"), true);
});

test("the limit applies across accounts sharing an IP", async () => {
  const database = new FakeRegistryDatabase();
  const clientA = database.createClient();
  const clientB = database.createClient();

  for (let index = 0; index < 5; index += 1) {
    const result = await join(index % 2 === 0 ? clientA : clientB, {
      userId: `clerk-user-${index}`,
    });
    assert.equal(result.kind, "invalid-code");
  }

  assert.equal((await join(clientB, { userId: "another-user" })).kind, "rate-limited");
});

test("the limit follows the verified account across different IP addresses", async () => {
  const database = new FakeRegistryDatabase();

  for (let index = 0; index < 5; index += 1) {
    assert.equal((await join(database.createClient(), {
      ipAddress: `203.0.113.${index + 1}`,
    })).kind, "invalid-code");
  }

  assert.equal((await join(database.createClient(), {
    ipAddress: "203.0.113.99",
  })).kind, "rate-limited");
});

test("an expired 15-minute window resets on the next failed attempt", async () => {
  const database = new FakeRegistryDatabase();
  const client = database.createClient();
  database.attempts.set("old-expired-key", [database.now - WINDOW_MS - 1]);

  for (let index = 0; index < 5; index += 1) {
    assert.equal((await join(client)).kind, "invalid-code");
  }
  database.now += WINDOW_MS + 1;

  assert.equal((await join(database.createClient())).kind, "invalid-code");
  assert.equal(database.attempts.has("old-expired-key"), false);
  for (const attempt of database.attempts.values()) {
    assert.deepEqual(attempt, [database.now]);
  }
});

test("the 15-minute limit uses a rolling window, not a resettable fixed bucket", async () => {
  const database = new FakeRegistryDatabase();
  const client = database.createClient();

  for (let index = 0; index < 4; index += 1) {
    assert.equal((await join(client)).kind, "invalid-code");
  }
  database.now += WINDOW_MS - 60_000;
  assert.equal((await join(client)).kind, "invalid-code");
  assert.equal((await join(client)).kind, "rate-limited");

  database.now += 60_001;
  assert.equal((await join(database.createClient())).kind, "invalid-code");
  assert.equal((await join(database.createClient())).kind, "invalid-code");
  assert.equal((await join(database.createClient())).kind, "invalid-code");
  assert.equal((await join(database.createClient())).kind, "invalid-code");
  assert.equal((await join(database.createClient())).kind, "rate-limited");
});

test("malformed codes are rejected without counting as failed code attempts", async () => {
  const database = new FakeRegistryDatabase();

  assert.equal((await join(database.createClient(), { code: "123" })).kind, "invalid-code");
  assert.equal(database.attempts.size, 0);
});
