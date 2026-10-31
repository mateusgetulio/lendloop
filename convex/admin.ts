import { internalMutation, mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v, ConvexError } from "convex/values";
import { requireActor, requireAdmin, boundPage } from "./lib/auth";
import { setTrusted } from "./lib/domain";
import { loanView } from "./loans";
export const promote = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    if (!(await ctx.db.get(userId))) throw new ConvexError("User not found.");
    await ctx.db.patch(userId, { role: "admin", updatedAt: Date.now() });
  },
});
export const loans = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const actorId = await requireActor(ctx);
    await requireAdmin(ctx, actorId);
    boundPage(args.paginationOpts);
    const page = await ctx.db
      .query("loans")
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (l) => ({
          ...loanView(l, actorId),
          lenderName: (await ctx.db.get(l.lenderId))?.displayName ?? "Neighbor",
          borrowerName:
            (await ctx.db.get(l.borrowerId))?.displayName ?? "Neighbor",
        })),
      ),
    };
  },
});
export const lenders = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const actorId = await requireActor(ctx);
    await requireAdmin(ctx, actorId);
    boundPage(args.paginationOpts);
    const page = await ctx.db.query("users").paginate(args.paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (u) => ({
          _id: u._id,
          displayName: u.displayName,
          trustedLender: u.trustedLender,
          listingNames: (
            await ctx.db
              .query("tools")
              .withIndex("by_owner", (q) =>
                q.eq("ownerId", u._id).eq("deletedAt", null),
              )
              .take(3)
          ).map((t) => t.name),
        })),
      ),
    };
  },
});
export const trust = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, args) =>
    setTrusted(ctx, await requireActor(ctx), args.userId, args.trusted),
});
