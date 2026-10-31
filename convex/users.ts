import { mutation, query } from "./_generated/server";
import { ConvexError } from "convex/values";
import { currentUser } from "./lib/auth";
export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const user = await currentUser(ctx);
    return {
      authenticated: identity !== null,
      user: user
        ? {
            _id: user._id,
            displayName: user.displayName,
            role: user.role,
            trustedLender: user.trustedLender,
          }
        : null,
    };
  },
});
export const ensureCurrent = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in before continuing.");
    const existing = await currentUser(ctx);
    if (existing) return existing._id;
    const now = Date.now();
    return ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      displayName: identity.name?.trim().slice(0, 100) || "Neighbor",
      role: "user",
      trustedLender: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});
