import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { requireActor, boundPage } from "./lib/auth";
import { requestLoan, transitionLoan } from "./lib/domain";
import { loanAction } from "./lib/validators";
import type { Doc, Id } from "./_generated/dataModel";
export function loanView(loan: Doc<"loans">, actorId: Id<"users">) {
  return {
    _id: loan._id,
    toolId: loan.toolId,
    toolName: loan.toolNameSnapshot,
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    isOwner: loan.lenderId === actorId,
    isBorrower: loan.borrowerId === actorId,
  };
}
export const list = query({
  args: {
    view: v.union(v.literal("borrowing"), v.literal("incoming")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const actorId = await requireActor(ctx);
    boundPage(args.paginationOpts);
    const source =
      args.view === "borrowing"
        ? ctx.db
            .query("loans")
            .withIndex("by_borrower", (q) => q.eq("borrowerId", actorId))
        : ctx.db
            .query("loans")
            .withIndex("by_lender", (q) => q.eq("lenderId", actorId));
    const page = await source.order("desc").paginate(args.paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (l) => ({
          ...loanView(l, actorId),
          otherPartyName:
            (
              await ctx.db.get(
                args.view === "borrowing" ? l.lenderId : l.borrowerId,
              )
            )?.displayName ?? "Neighbor",
        })),
      ),
    };
  },
});
export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, args) => requestLoan(ctx, await requireActor(ctx), args),
});
export const transition = mutation({
  args: { loanId: v.id("loans"), action: loanAction },
  handler: async (ctx, args) =>
    transitionLoan(ctx, await requireActor(ctx), args.loanId, args.action),
});
