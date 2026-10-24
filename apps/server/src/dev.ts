import { loadConfig } from "./config.js";
import { openDatabase } from "./database.js";
import { createApp } from "./app.js";
import { startDevelopmentWorker } from "./services/developmentWorker.js";
const config = loadConfig();
const db = openDatabase(config.databasePath);
const stop = startDevelopmentWorker(db, config);
const server = createApp(db, config).listen(config.port, config.host, () =>
  console.log(`SocialSync API: http://${config.host}:${config.port}`),
);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    const stopping = stop();
    server.close(() => {
      void stopping.then(() => {
        db.close();
        process.exit(0);
      });
    });
  });
