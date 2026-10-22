import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
const target = new URL("../apps/server/.env", import.meta.url);
if (existsSync(target)) {
  console.log("Server .env already exists; preserved without changes.");
} else {
  const template = readFileSync(
    new URL("../apps/server/.env.example", import.meta.url),
    "utf8",
  );
  writeFileSync(
    target,
    template.replace(
      "ENCRYPTION_KEY=",
      "ENCRYPTION_KEY=" + randomBytes(32).toString("hex"),
    ),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "Created apps/server/.env with a new local encryption key. Keep this key with your backups.",
  );
}
