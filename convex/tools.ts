import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { listingFields, category } from "./lib/validators";
import { boundPage, requireActor } from "./lib/auth";
import {
  approvedLoans,
  createListing,
  editListing,
  removeListing,
} from "./lib/domain";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
async function day(ctx: QueryCtx) {
  return (
    await ctx.db
      .query("systemState")
      .withIndex("by_key", (q) => q.eq("key", "calendar"))
      .unique()
  )?.today;
}
async function summary(
  ctx: QueryCtx,
  tool: Doc<"tools">,
  today: string,
  actorId: Id<"users">,
) {
  const owner = await ctx.db.get(tool.ownerId),
    approved = await approvedLoans(ctx, tool._id);
  return {
    _id: tool._id,
    name: tool.name,
    category: tool.category,
    condition: tool.condition,
    description: tool.description,
    ownerName: owner?.displayName ?? "Neighbor",
    trustedLender: owner?.trustedLender ?? false,
    isOwner: tool.ownerId === actorId,
    availability: approved.some((l) => l.endDate < today)
      ? "Overdue"
      : approved.some((l) => l.startDate <= today && today <= l.endDate)
        ? "Out today"
        : "Available today",
  };
}
export const listPublicAvailable = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    boundPage(args.paginationOpts);
    const today = await day(ctx);
    if (!today) return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db
      .query("tools")
      .withIndex("by_deleted_category", (q) => q.eq("deletedAt", null))
      .paginate(args.paginationOpts);
    const available = await Promise.all(
      page.page.map(async (tool) => {
        const loans = await approvedLoans(ctx, tool._id);
        return loans.some((l) => l.startDate <= today)
          ? null
          : { name: tool.name, category: tool.category };
      }),
    );
    return {
      ...page,
      page: available.filter(
        (t): t is { name: string; category: Doc<"tools">["category"] } =>
          t !== null,
      ),
    };
  },
});
export const list = query({
  args: {
    category: v.optional(category),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const actorId = await requireActor(ctx);
    boundPage(args.paginationOpts);
    const today = await day(ctx);
    if (!today) return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db
      .query("tools")
      .withIndex("by_deleted_category", (q) =>
        args.category
          ? q.eq("deletedAt", null).eq("category", args.category)
          : q.eq("deletedAt", null),
      )
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map((t) => summary(ctx, t, today, actorId)),
      ),
    };
  },
});
export const mine = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const actorId = await requireActor(ctx);
    boundPage(args.paginationOpts);
    const today = await day(ctx);
    if (!today) return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", actorId).eq("deletedAt", null),
      )
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map((t) => summary(ctx, t, today, actorId)),
      ),
    };
  },
});
export const detail = query({
  args: { toolId: v.string() },
  handler: async (ctx, args) => {
    const actorId = await requireActor(ctx),
      today = await day(ctx),
      toolId = ctx.db.normalizeId("tools", args.toolId),
      tool = toolId && (await ctx.db.get(toolId));
    if (!tool || tool.deletedAt !== null || !today) return null;
    const busy = (await approvedLoans(ctx, tool._id)).sort((a, b) =>
      a.startDate.localeCompare(b.startDate),
    );
    return {
      ...(await summary(ctx, tool, today, actorId)),
      hasMoreBusyRanges: busy.length > 50,
      busy: busy.slice(0, 50).map((l) => ({
        startDate: l.startDate,
        endDate: l.endDate,
      })),
    };
  },
});
export const create = mutation({
  args: listingFields,
  handler: async (ctx, args) =>
    createListing(ctx, await requireActor(ctx), args),
});
export const edit = mutation({
  args: { toolId: v.id("tools"), ...listingFields },
  handler: async (ctx, { toolId, ...input }) =>
    editListing(ctx, await requireActor(ctx), toolId, input),
});
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, args) =>
    removeListing(ctx, await requireActor(ctx), args.toolId),
});
