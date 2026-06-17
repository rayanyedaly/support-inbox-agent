// tests/setup/global-setup.ts
//
// Runs once before the whole suite: migrate + seed the dedicated test database.
// Both are idempotent (migrate deploy applies only pending migrations; the seed
// deletes-then-recreates), so re-running is safe.

import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";

export default async function setup() {
  // Force the test DB url for the migrate/seed subprocesses (override any dev .env
  // that Prisma might auto-load). CI has no .env.test → fall back to the env var.
  const parsed = loadEnv({ path: ".env.test", override: true }).parsed ?? {};
  const DATABASE_URL = parsed.DATABASE_URL ?? process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — create .env.test (see .env.example) or set the env var.");
  }
  if (!/inbox_test/.test(DATABASE_URL)) {
    // Guard: never migrate/seed (which wipes data) against a non-test database.
    throw new Error(`Refusing to seed a non-test database: ${DATABASE_URL}`);
  }

  const env = { ...process.env, DATABASE_URL };
  // String form goes through the shell, which resolves npx.cmd on Windows.
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  execSync("npx prisma db seed", { stdio: "inherit", env });
}
