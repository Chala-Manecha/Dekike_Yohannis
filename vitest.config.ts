import { defineConfig } from "vitest/config";

// Unit tests run in plain Node; they cover pure logic (permissions, validation,
// Telegram signature checks) and never touch the React Router / Workers plugins.
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
