import type { Config } from "../config.js";
import type { DB } from "../database.js";
import { startWorker, WorkerAlreadyRunningError } from "./schedulingWorker.js";

// A watch restart may outpace a previous worker's lease. Keep the API available
// while acquiring ownership through the same lock as the standalone worker.
export function startDevelopmentWorker(db: DB, config: Config) {
  let stop: (() => Promise<void>) | undefined;
  let retry: ReturnType<typeof setInterval> | undefined;
  const attempt = () => {
    try {
      stop = startWorker(db, config);
      clearInterval(retry);
      console.log("SocialSync publishing worker started.");
    } catch (error) {
      if (!(error instanceof WorkerAlreadyRunningError)) throw error;
    }
  };
  attempt();
  if (!stop) {
    console.warn(
      "Another publishing worker holds the scheduler lease. The API remains available; worker startup will retry.",
    );
    retry = setInterval(attempt, 1000);
  }
  return async () => {
    clearInterval(retry);
    await stop?.();
  };
}
