import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { listingFields, status } from "./lib/validators";
const timestamps = { createdAt: v.number(), updatedAt: v.number() };
export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    displayName: v.string(),
    role: v.union(v.literal("user"), v.literal("admin")),
    trustedLender: v.boolean(),
    ...timestamps,
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),
  tools: defineTable({
    ownerId: v.id("users"),
    ...listingFields,
    deletedAt: v.union(v.null(), v.number()),
    ...timestamps,
  })
    .index("by_owner", ["ownerId", "deletedAt"])
    .index("by_deleted_category", ["deletedAt", "category"]),
  loans: defineTable({
    toolId: v.id("tools"),
    lenderId: v.id("users"),
    borrowerId: v.id("users"),
    toolNameSnapshot: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    status,
    returnedAt: v.optional(v.number()),
    ...timestamps,
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_borrower", ["borrowerId"])
    .index("by_lender", ["lenderId"])
    .index("by_status_endDate", ["status", "endDate"]),
  automationEvents: defineTable({
    type: v.union(
      v.literal("requested"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("cancelled"),
      v.literal("returned"),
    ),
    loanId: v.id("loans"),
    recipientId: v.id("users"),
    payload: v.object({
      toolName: v.string(),
      status,
      startDate: v.string(),
      endDate: v.string(),
    }),
    occurredAt: v.number(),
    state: v.union(
      v.literal("pending"),
      v.literal("delivered"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    nextAttemptAt: v.number(),
    lastError: v.optional(v.string()),
    ...timestamps,
  }).index("by_state_nextAttemptAt", ["state", "nextAttemptAt"]),
  notifications: defineTable({
    key: v.string(),
    loanId: v.id("loans"),
    recipientId: v.id("users"),
    kind: v.string(),
    message: v.string(),
    eventId: v.optional(v.id("automationEvents")),
    occurredAt: v.number(),
    n8nExecutionId: v.string(),
    ...timestamps,
  })
    .index("by_key", ["key"])
    .index("by_loan", ["loanId", "occurredAt"])
    .index("by_recipient", ["recipientId", "occurredAt"]),
  automationFailures: defineTable({
    key: v.string(),
    source: v.string(),
    reference: v.string(),
    message: v.string(),
    createdAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_createdAt", ["createdAt"]),
  systemState: defineTable({
    key: v.string(),
    today: v.string(),
    lastOverdueFetchDate: v.optional(v.string()),
    lastHealthCheckDate: v.optional(v.string()),
  }).index("by_key", ["key"]),
});
