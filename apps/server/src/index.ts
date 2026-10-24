import { loadConfig } from "./config.js";
import { openDatabase } from "./database.js";
import { createApp } from "./app.js";
const config = loadConfig();
const db = openDatabase(config.databasePath);
const server = createApp(db, config).listen(config.port, config.host, () =>
  console.log(
    `SocialSync API listening at http://${config.host}:${config.port}`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
