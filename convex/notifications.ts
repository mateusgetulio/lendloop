import { query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { boundPage, requireActor } from "./lib/auth";
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const actorId = await requireActor(ctx);
    boundPage(args.paginationOpts);
    const page = await ctx.db
      .query("notifications")
      .withIndex("by_recipient", (q) => q.eq("recipientId", actorId))
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((n) => ({
        _id: n._id,
        kind: n.kind,
        message: n.message,
        occurredAt: n.occurredAt,
      })),
    };
  },
});
