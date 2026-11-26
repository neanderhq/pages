import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile, readdir, mkdir } from "node:fs/promises";
import * as schema from "./schema.ts";

// Every migration is idempotent and re-applied in filename order on startup.
async function readMigrations() {
  const directory = new URL("./migrations/", import.meta.url);
  const names = (await readdir(directory)).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
  return Promise.all(names.map(name => readFile(new URL(name, directory), "utf8")));
}

export async function openDatabase(dataDir = process.env.DATA_DIR || ".data/wiki") {
  if (dataDir !== "memory://") await mkdir(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  await client.waitReady;
  for (const migration of await readMigrations()) await client.exec(`BEGIN; ${migration} COMMIT;`);
  return { db: drizzle(client, { schema }), close: () => client.close() };
}
export type Database = Awaited<ReturnType<typeof openDatabase>>["db"];
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function openConfiguredDatabase() {
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === "production") throw new Error("Production requires DATABASE_URL pointing to PostgreSQL.");
    return openDatabase();
  }
  const driverName = "pg";
  let driver;
  try { driver = await import(driverName); }
  catch { throw new Error("DATABASE_URL requires the PostgreSQL driver. Install it with pnpm add pg before production deployment."); }
  const { drizzle: postgresDrizzle } = await import("drizzle-orm/node-postgres");
  const pool = new driver.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (process.env.NODE_ENV === "production") {
      // Schema changes belong to Neander's versioned pre-rollout migration job.
      // Starting or scaling a web instance must never apply DDL or rewrite data.
      const result = await pool.query("SELECT to_regclass('public.auth_users') AS users, to_regclass('public.attachment_contents') AS uploads");
      if (!result.rows[0].users || !result.rows[0].uploads) {
        throw new Error("Database schema is not initialized. Apply the committed Drizzle migrations before starting the app.");
      }
    } else {
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        await connection.query("SELECT pg_advisory_xact_lock(68021427)");
        for (const migration of await readMigrations()) await connection.query(migration);
        await connection.query("COMMIT");
      } catch (error) { await connection.query("ROLLBACK"); throw error; }
      finally { connection.release(); }
    }
  } catch (error) { await pool.end(); throw error; }
  return { db: postgresDrizzle(pool, { schema }) as unknown as Database, close: () => pool.end() as Promise<void> };
}
