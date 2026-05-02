import { Router, type IRouter } from "express";
import { getOnlineUsers } from "../presence";

const router: IRouter = Router();

router.get("/presence", (_req, res): void => {
  res.json({ users: getOnlineUsers(), count: getOnlineUsers().length });
});

export default router;
