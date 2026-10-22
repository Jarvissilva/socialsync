import { Router } from "express";
import type { DB } from "../database.js";
import type { Config } from "../config.js";
import { requireProject } from "../middleware/requireProject.js";
import { projectAccountController } from "../controllers/projectAccountController.js";
import { mediaController } from "../controllers/mediaController.js";
import { postController } from "../controllers/postController.js";
export function projectRouter(db: DB, config: Config) {
  const router = Router({ mergeParams: true });
  router.use(requireProject(db));
  {
    const c = projectAccountController(db, config);
    router.get("/accounts", c.list);
    router.post("/accounts", c.assign);
    router.delete("/accounts/:accountId", c.remove);
    router.get("/accounts/:accountId/boards", c.boards);
  }
  {
    const c = mediaController(db, config);
    router.get("/media", c.list);
    router.post("/media", c.uploadFile, c.upload);
    router.get("/media/:mediaId/file", c.file);
    router.delete("/media/:mediaId", c.remove);
  }
  {
    const c = postController(db, config);
    router.get("/posts", c.list);
    router.post("/posts", c.create);
    router.get("/posts/:postId", c.read);
    router.put("/posts/:postId", c.update);
    router.post("/posts/:postId/schedule", c.schedule);
    router.post("/posts/:postId/cancel", c.cancel);
    router.post("/posts/:postId/destinations/:jobId/retry", c.retry);
    router.post("/posts/:postId/destinations/:jobId/resolve", c.resolve);
  }
  return router;
}
