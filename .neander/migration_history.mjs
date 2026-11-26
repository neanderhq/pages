// Sandbox helper: apply Drizzle migrations only on top of an unchanged applied
// prefix of this source's journal, then confirm the database matches it.
// Drizzle applies every pending file in one transaction, so a rerun after an
// interrupted attempt is safe.
import fs from "node:fs";
import { Client } from "pg";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
if (!migrations.length || migrations.some((m, i) => i && m.folderMillis <= migrations[i - 1].folderMillis)) {
  throw new Error("Drizzle migrations require strictly increasing journal timestamps");
}
const desired = migrations.map(m => `${m.folderMillis}:${m.hash}`);
if (process.argv.includes("--validate")) process.exit(0);
const state = process.env.NEANDER_MIGRATION_STATE_DIR || "/run/neander";
const { DATABASE_URL } = JSON.parse(fs.readFileSync(`${state}/database.json`, "utf8"));
const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 120000 });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

async function history() {
  const exists = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS name");
  if (!exists.rows[0].name) return [];
  const result = await client.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id");
  return result.rows.map(row => `${row.created_at}:${row.hash}`);
}

await client.connect();
try {
  // Serializes platform runners; released when this session ends.
  await client.query("SELECT pg_advisory_lock(1313161540, 1)");
  const other = await client.query("SELECT to_regclass('public.alembic_version') AS name");
  if (other.rows[0].name && (await client.query("SELECT 1 FROM public.alembic_version LIMIT 1")).rowCount) {
    console.log("NEANDER_MIGRATION_REJECTED: migration_profile_changed");
    process.exitCode = 1;
  } else {
    const current = await history();
    if (!same(current, desired.slice(0, current.length))) {
      console.log("NEANDER_MIGRATION_REJECTED: drizzle_history_changed");
      process.exitCode = 1;
    } else {
      if (!same(current, desired)) await migrate(drizzle(client), { migrationsFolder: "drizzle" });
      if (!same(await history(), desired)) {
        console.log("NEANDER_MIGRATION_REJECTED: drizzle_history_incomplete");
        process.exitCode = 1;
      }
    }
  }
} finally {
  await client.end();
}
