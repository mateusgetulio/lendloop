import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
export async function currentUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
}
export async function requireActor(ctx: QueryCtx) {
  const user = await currentUser(ctx);
  if (!user) throw new ConvexError("Sign in before continuing.");
  return user._id;
}
export async function requireAdmin(ctx: QueryCtx, actorId: Id<"users">) {
  const user = await ctx.db.get(actorId);
  if (!user || user.role !== "admin")
    throw new ConvexError("Administrator access required.");
  return user;
}
export function boundPage(options: { numItems: number }) {
  if (
    !Number.isInteger(options.numItems) ||
    options.numItems < 1 ||
    options.numItems > 50
  )
    throw new ConvexError("Choose a page size from 1 to 50.");
}
