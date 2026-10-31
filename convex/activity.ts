import { query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { boundPage, requireActor } from "./lib/auth";

export const list = query({
  args: { loanId: v.id("loans"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { loanId, paginationOpts }) => {
    const actorId = await requireActor(ctx),
      loan = await ctx.db.get(loanId),
      actor = await ctx.db.get(actorId);
    if (
      !loan ||
      (loan.borrowerId !== actorId &&
        loan.lenderId !== actorId &&
        actor?.role !== "admin")
    )
      throw new ConvexError("You cannot view activity for this loan.");
    boundPage(paginationOpts);
    const page = await ctx.db
      .query("notifications")
      .withIndex("by_loan", (q) => q.eq("loanId", loanId))
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...page,
      page: page.page.map((row) => ({
        kind: row.kind,
        occurredAt: row.occurredAt,
      })),
    };
  },
});
