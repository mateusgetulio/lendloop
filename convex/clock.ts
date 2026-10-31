import { internalMutation, query } from "./_generated/server";
import { refreshCalendar } from "./lib/automation";
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    await refreshCalendar(ctx, Date.now());
  },
});
export const settings = query({
  args: {},
  handler: async (ctx) => ({
    today:
      (
        await ctx.db
          .query("systemState")
          .withIndex("by_key", (q) => q.eq("key", "calendar"))
          .unique()
      )?.today ?? null,
    timezone: process.env.APP_TIMEZONE ?? "UTC",
  }),
});
