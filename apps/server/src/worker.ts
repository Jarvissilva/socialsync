import { loadConfig } from "./config.js";
import { openDatabase } from "./database.js";
import { startWorker } from "./services/schedulingWorker.js";
const config = loadConfig();
const db = openDatabase(config.databasePath);
const stop = startWorker(db, config);
console.log("SocialSync publishing worker started.");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void stop().then(() => {
      db.close();
      process.exit(0);
    });
  });
