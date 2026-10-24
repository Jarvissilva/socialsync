import { fileURLToPath } from "node:url";

// Anchor relative DATA_DIR and .env resolution to the same directory as pnpm dev.
process.chdir(fileURLToPath(new URL("../apps/server/", import.meta.url)));
try {
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await import("../apps/server/dist/mcp.js");
} catch {
  console.error(
    "SocialSync MCP could not start. Run pnpm build and check apps/server/.env (including ENCRYPTION_KEY).",
  );
  process.exitCode = 1;
}
