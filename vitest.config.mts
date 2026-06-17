import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { config as loadEnv } from "dotenv";

// .mts so the ESM-only Vitest config chain loads correctly in this CommonJS project.
//
// Read the test DB url deterministically from .env.test (local) or fall back to the
// process env (CI sets DATABASE_URL directly). Integration tests' DB clients
// (lib/agent/tools.ts news up its own, lib/prisma.ts) read DATABASE_URL at import,
// so the worker env below must carry it.
const testEnv = loadEnv({ path: ".env.test" }).parsed ?? {};
const DATABASE_URL = testEnv.DATABASE_URL ?? process.env.DATABASE_URL ?? "";

export default defineConfig({
  plugins: [tsconfigPaths()], // resolves the "@/" alias (Vite's tsconfigPaths isn't honored by Vitest)
  test: {
    environment: "node",
    globalSetup: ["./tests/setup/global-setup.ts"],
    include: ["tests/**/*.test.ts"],
    pool: "forks", // process isolation — safest for Prisma + import-time clients
    env: { DATABASE_URL },
  },
});
