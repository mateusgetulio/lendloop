import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.interval("Refresh calendar", { minutes: 1 }, internal.clock.tick);
crons.interval("Recover deliveries", { minutes: 1 }, internal.automation.sweep);
export default crons;
