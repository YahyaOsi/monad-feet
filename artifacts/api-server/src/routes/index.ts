import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import invitesRouter from "./invites";
import postsRouter from "./posts";
import commentsRouter from "./comments";
import subscriptionsRouter from "./subscriptions";
import streakRouter from "./streak";
import feedRouter from "./feed";
import notificationsRouter from "./notifications";
import storageRouter from "./storage";
import presenceRouter from "./presence";
import trendingRouter from "./trending";
import leaderboardRouter from "./leaderboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(invitesRouter);
router.use(postsRouter);
router.use(commentsRouter);
router.use(subscriptionsRouter);
router.use(streakRouter);
router.use(feedRouter);
router.use(notificationsRouter);
router.use(storageRouter);
router.use(presenceRouter);
router.use(trendingRouter);
router.use(leaderboardRouter);

export default router;
