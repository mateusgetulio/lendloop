import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.interval("Refresh calendar", { minutes: 1 }, internal.clock.tick);
export default crons;
