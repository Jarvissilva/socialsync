import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./database.js";
import { createMcpServer } from "./mcp/server.js";
import { importProviderApps } from "./services/providerAppService.js";

let db: ReturnType<typeof openDatabase> | undefined;
try {
  const config = loadConfig();
  const database = openDatabase(config.databasePath);
  db = database;
  // Let in-flight imports/provider reads finish before closing their database.
  process.once("exit", () => {
    if (database.open) database.close();
  });
  importProviderApps(database, config);
  const server = createMcpServer(database, config);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    try {
      await server.close();
    } catch {
      console.error("SocialSync MCP could not close its transport cleanly.");
      process.exitCode = 1;
    }
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void close();
    });
  process.stdin.once("end", () => {
    void close();
  });
  await server.connect(new StdioServerTransport());
} catch {
  if (db?.open) db.close();
  console.error(
    "SocialSync MCP could not start. Check server configuration and build output.",
  );
  process.exitCode = 1;
}
