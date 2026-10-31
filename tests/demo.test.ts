/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
const modules = import.meta.glob("../convex/**/*.ts");
beforeEach(() => {
  vi.stubEnv("DEMO_SEED_ENABLED", "true");
  vi.stubEnv("APP_TIMEZONE", "America/Sao_Paulo");
});
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules);
  const lender = t.withIdentity({
    subject: "lender",
    issuer: "https://test.clerk.accounts.dev",
  });
  const borrower = t.withIdentity({
    subject: "borrower",
    issuer: "https://test.clerk.accounts.dev",
  });
  const other = t.withIdentity({
    subject: "other",
    issuer: "https://test.clerk.accounts.dev",
  });
  const lenderId = await lender.mutation(api.users.ensureCurrent, {}),
    borrowerId = await borrower.mutation(api.users.ensureCurrent, {}),
    otherId = await other.mutation(api.users.ensureCurrent, {});
  return { t, lender, borrower, other, lenderId, borrowerId, otherId };
}
it("refuses disabled data creation and requires two distinct existing signed-in accounts", async () => {
  const { t, lenderId, borrowerId } = await setup();
  vi.stubEnv("DEMO_SEED_ENABLED", "false");
  await expect(
    t.mutation(internal.seed.demo, { lenderId, borrowerId }),
  ).rejects.toThrow("disabled");
  vi.stubEnv("DEMO_SEED_ENABLED", "true");
  await expect(
    t.mutation(internal.seed.demo, { lenderId, borrowerId: lenderId }),
  ).rejects.toThrow("distinct");
  expect(await t.run((ctx) => ctx.db.query("tools").collect())).toHaveLength(0);
});
it("creates readable distinct tools and four date scenarios without adding identities", async () => {
  const { t, lenderId, borrowerId } = await setup();
  const result = await t.mutation(internal.seed.demo, { lenderId, borrowerId });
  const loans = await t.run((ctx) => ctx.db.query("loans").collect());
  expect(loans).toHaveLength(4);
  expect(
    loans.filter(
      (l) => l.status === "approved" && l.endDate < result.businessDate,
    ),
  ).toHaveLength(1);
  expect(loans.filter((l) => l.endDate === result.businessDate)).toHaveLength(
    1,
  );
  expect(loans.filter((l) => l.startDate > result.businessDate)).toHaveLength(
    1,
  );
  expect(loans.filter((l) => l.status === "returned")).toHaveLength(1);
  expect(new Set(loans.map((l) => l.toolId)).size).toBe(4);
  expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(3);
});
it("repeating data creation preserves edits, returns, removal and all record identifiers", async () => {
  const { t, lenderId, borrowerId } = await setup();
  const first = await t.mutation(internal.seed.demo, { lenderId, borrowerId });
  const entry = first.entries[0];
  await t.run(async (ctx) => {
    await ctx.db.patch(entry.toolId, {
      name: "Renamed drill",
      deletedAt: Date.now(),
    });
    await ctx.db.patch(entry.loanId!, {
      status: "returned",
      returnedAt: Date.now(),
    });
  });
  const second = await t.mutation(internal.seed.demo, { lenderId, borrowerId });
  expect(second.entries.map((e) => e.toolId)).toEqual(
    first.entries.map((e) => e.toolId),
  );
  expect(second.entries.every((e) => !e.created)).toBe(true);
  expect((await t.run((ctx) => ctx.db.get(entry.toolId)))?.name).toBe(
    "Renamed drill",
  );
  expect((await t.run((ctx) => ctx.db.get(entry.loanId!)))?.status).toBe(
    "returned",
  );
  expect(
    await t.run((ctx) => ctx.db.query("automationEvents").collect()),
  ).toHaveLength(4);
});
it("a different borrower cannot silently reuse another demo pair", async () => {
  const { t, lenderId, borrowerId, otherId } = await setup();
  await t.mutation(internal.seed.demo, { lenderId, borrowerId });
  await expect(
    t.mutation(internal.seed.demo, { lenderId, borrowerId: otherId }),
  ).rejects.toThrow("original pair");
  expect(await t.run((ctx) => ctx.db.query("tools").collect())).toHaveLength(5);
});
it("loan activity is participant/admin only, orders by occurrence and returns exactly kind and time", async () => {
  const { t, lender, borrower, other, lenderId, borrowerId, otherId } =
    await setup();
  const seeded = await t.mutation(internal.seed.demo, { lenderId, borrowerId });
  const loanId = seeded.entries[0].loanId!;
  await t.run(async (ctx) => {
    for (const [key, occurredAt] of [
      ["late", 2000],
      ["early", 1000],
    ] as const)
      await ctx.db.insert("notifications", {
        key,
        loanId,
        recipientId: borrowerId,
        kind: "overdue",
        message: "Private message",
        n8nExecutionId: "example",
        occurredAt,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
  });
  const args = { loanId, paginationOpts: { numItems: 20, cursor: null } };
  for (const client of [lender, borrower]) {
    const result = await client.query(api.activity.list, args);
    expect(result.page).toEqual([
      { kind: "overdue", occurredAt: 2000 },
      { kind: "overdue", occurredAt: 1000 },
    ]);
  }
  await expect(other.query(api.activity.list, args)).rejects.toThrow(
    "cannot view",
  );
  await expect(t.query(api.activity.list, args)).rejects.toThrow("Sign in");
  await t.mutation(internal.admin.promote, { userId: otherId });
  expect((await other.query(api.activity.list, args)).page).toHaveLength(2);
});
