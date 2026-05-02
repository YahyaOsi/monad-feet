import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import invitesRouter from "./invites";
import postsRouter from "./posts";
import subscriptionsRouter from "./subscriptions";
import streakRouter from "./streak";
import feedRouter from "./feed";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(invitesRouter);
router.use(postsRouter);
router.use(subscriptionsRouter);
router.use(streakRouter);
router.use(feedRouter);

export default router;
