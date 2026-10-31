import { internalMutation, query } from "./_generated/server";
import { today } from "./lib/dates";
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const day = today();
    const state = await ctx.db
      .query("systemState")
      .withIndex("by_key", (q) => q.eq("key", "calendar"))
      .unique();
    if (!state)
      await ctx.db.insert("systemState", { key: "calendar", today: day });
    else if (state.today !== day) await ctx.db.patch(state._id, { today: day });
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
