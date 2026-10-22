import { loadConfig } from "./config.js";
import { openDatabase } from "./database.js";
import { createApp } from "./app.js";
import { startWorker } from "./services/schedulingWorker.js";
const config = loadConfig();
const db = openDatabase(config.databasePath);
const stop = startWorker(db, config);
const server = createApp(db, config).listen(config.port, config.host, () =>
  console.log(
    `SocialDesk API and worker: http://${config.host}:${config.port}`,
  ),
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
