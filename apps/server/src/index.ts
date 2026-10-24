import { loadConfig } from "./config.js";
import { openDatabase } from "./database.js";
import { createApp } from "./app.js";
import { startAppWorker } from "./services/appWorker.js";
const config = loadConfig();
const db = openDatabase(config.databasePath);
const app = createApp(db, config);
const stopWorker = startAppWorker(db, config);
const server = app.listen(config.port, config.host, () =>
  console.log(`SocialSync listening at http://${config.host}:${config.port}`),
);
let closing = false;
async function shutdown(exitCode = 0) {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => process.exit(1), 25_000);
  timeout.unref();
  try {
    await Promise.all([
      stopWorker(),
      new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    ]);
    db.close();
    process.exit(exitCode);
  } catch {
    console.error("SocialSync could not shut down cleanly.");
    process.exit(1);
  }
}
server.on("error", () => {
  console.error(
    "SocialSync could not listen. Check the configured host and port.",
  );
  void shutdown(1);
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void shutdown();
  });
