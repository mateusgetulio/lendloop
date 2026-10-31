import { v } from "convex/values";
export const category = v.union(
  v.literal("power_tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("other"),
);
export const condition = v.union(
  v.literal("like_new"),
  v.literal("good"),
  v.literal("fair"),
);
export const status = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);
export const listingFields = {
  name: v.string(),
  category,
  condition,
  description: v.string(),
};
export const loanAction = v.union(
  v.literal("approve"),
  v.literal("decline"),
  v.literal("cancel"),
  v.literal("return"),
);
