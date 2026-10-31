/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { calendarDay, validDate } from "../convex/lib/dates";
import { formatRange, overlaps } from "../lib/catalog";
const modules = import.meta.glob("../convex/**/*.ts");
const page = { paginationOpts: { numItems: 20, cursor: null } };
const listing = {
  name: "Cordless drill",
  category: "power_tools" as const,
  condition: "good" as const,
  description: "A small drill for household repairs.",
};
function setup() {
  return convexTest(schema, modules);
}
async function fixture() {
  const t = setup();
  const owner = t.withIdentity({
    subject: "owner",
    issuer: "https://test.clerk.accounts.dev",
    name: "Alex",
  });
  const borrower = t.withIdentity({
    subject: "borrower",
    issuer: "https://test.clerk.accounts.dev",
    name: "Sam",
  });
  const other = t.withIdentity({
    subject: "other",
    issuer: "https://test.clerk.accounts.dev",
  });
  const admin = t.withIdentity({
    subject: "admin",
    issuer: "https://test.clerk.accounts.dev",
    name: "Robin",
  });
  const ownerId = await owner.mutation(api.users.ensureCurrent, {}),
    borrowerId = await borrower.mutation(api.users.ensureCurrent, {}),
    otherId = await other.mutation(api.users.ensureCurrent, {}),
    adminId = await admin.mutation(api.users.ensureCurrent, {});
  await t.mutation(internal.admin.promote, { userId: adminId });
  await t.mutation(internal.clock.tick, {});
  const toolId = await owner.mutation(api.tools.create, listing);
  const request = (startDate = "2026-10-31", endDate = "2026-11-02") =>
    borrower.mutation(api.loans.request, { toolId, startDate, endDate });
  return {
    t,
    owner,
    borrower,
    other,
    admin,
    ownerId,
    borrowerId,
    otherId,
    adminId,
    toolId,
    request,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
  vi.stubEnv("APP_TIMEZONE", "UTC");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function counts(t: ReturnType<typeof setup>) {
  return t.run(async (ctx) => ({
    loans: (await ctx.db.query("loans").collect()).length,
    events: (await ctx.db.query("automationEvents").collect()).length,
  }));
}
describe("Identity and server permissions", () => {
  it("provisions once from verified identity, ignores no client role, and returns a safe current profile", async () => {
    const { t, owner, ownerId, other } = await fixture();
    expect(await owner.mutation(api.users.ensureCurrent, {})).toBe(ownerId);
    expect((await other.query(api.users.current, {})).user?.displayName).toBe(
      "Neighbor",
    );
    expect(await t.query(api.users.current, {})).toEqual({
      authenticated: false,
      user: null,
    });
    await expect(t.mutation(api.users.ensureCurrent, {})).rejects.toThrow();
    const profile = (await owner.query(api.users.current, {})).user!;
    expect(profile.role).toBe("user");
    expect(profile).not.toHaveProperty("tokenIdentifier");
    await expect(
      owner.mutation(api.users.ensureCurrent, { role: "admin" } as never),
    ).rejects.toThrow();
  });
  it("denies every anonymous authenticated entry point", async () => {
    const f = await fixture(),
      loanId = await f.request();
    for (const call of [
      () => f.t.query(api.tools.list, page),
      () => f.t.query(api.tools.mine, page),
      () => f.t.query(api.tools.detail, { toolId: f.toolId }),
      () => f.t.query(api.loans.list, { ...page, view: "borrowing" }),
      () => f.t.query(api.admin.loans, page),
      () => f.t.query(api.admin.lenders, page),
      () => f.t.mutation(api.tools.create, listing),
      () => f.t.mutation(api.tools.edit, { toolId: f.toolId, ...listing }),
      () => f.t.mutation(api.tools.remove, { toolId: f.toolId }),
      () =>
        f.t.mutation(api.loans.request, {
          toolId: f.toolId,
          startDate: "2026-10-31",
          endDate: "2026-11-01",
        }),
      () => f.t.mutation(api.loans.transition, { loanId, action: "approve" }),
      () => f.t.mutation(api.admin.trust, { userId: f.ownerId, trusted: true }),
    ])
      await expect(call()).rejects.toThrow();
  });
  it("rejects foreign listing mutations, spoofed actor arguments, and foreign loan actions", async () => {
    const f = await fixture(),
      loanId = await f.request();
    await expect(
      f.borrower.mutation(api.tools.edit, { toolId: f.toolId, ...listing }),
    ).rejects.toThrow();
    await expect(
      f.other.mutation(api.tools.remove, { toolId: f.toolId }),
    ).rejects.toThrow();
    await expect(
      f.admin.mutation(api.tools.edit, { toolId: f.toolId, ...listing }),
    ).rejects.toThrow();
    await expect(
      f.borrower.mutation(api.tools.create, {
        ...listing,
        ownerId: f.ownerId,
      } as never),
    ).rejects.toThrow();
    for (const action of ["approve", "decline", "return", "cancel"] as const)
      await expect(
        f.other.mutation(api.loans.transition, { loanId, action }),
      ).rejects.toThrow();
    await expect(
      f.borrower.mutation(api.loans.transition, { loanId, action: "approve" }),
    ).rejects.toThrow();
    await expect(
      f.owner.mutation(api.loans.transition, { loanId, action: "cancel" }),
    ).rejects.toThrow();
    expect(await counts(f.t)).toEqual({ loans: 1, events: 1 });
  });
  it("isolates personal queries and restricts admin views/trust", async () => {
    const f = await fixture();
    await f.request();
    expect(
      (await f.borrower.query(api.loans.list, { ...page, view: "borrowing" }))
        .page,
    ).toHaveLength(1);
    expect(
      (await f.owner.query(api.loans.list, { ...page, view: "incoming" })).page,
    ).toHaveLength(1);
    expect(
      (await f.other.query(api.loans.list, { ...page, view: "borrowing" }))
        .page,
    ).toEqual([]);
    expect(
      (await f.other.query(api.loans.list, { ...page, view: "incoming" })).page,
    ).toEqual([]);
    expect((await f.other.query(api.tools.mine, page)).page).toEqual([]);
    await expect(f.owner.query(api.admin.loans, page)).rejects.toThrow();
    await expect(f.owner.query(api.admin.lenders, page)).rejects.toThrow();
    await expect(
      f.owner.mutation(api.admin.trust, { userId: f.ownerId, trusted: true }),
    ).rejects.toThrow();
    await f.admin.mutation(api.admin.trust, {
      userId: f.ownerId,
      trusted: true,
    });
    expect(
      (await f.borrower.query(api.tools.detail, { toolId: f.toolId }))
        ?.trustedLender,
    ).toBe(true);
    expect((await f.admin.query(api.admin.loans, page)).page).toHaveLength(1);
    expect((await f.owner.query(api.users.current, {})).user?.role).toBe(
      "user",
    );
  });
});
describe("Listings and public data minimization", () => {
  it("trims, validates, edits only owner fields and soft deletes", async () => {
    const f = await fixture();
    await f.owner.mutation(api.tools.edit, {
      toolId: f.toolId,
      ...listing,
      name: "  Hand drill  ",
    });
    expect((await f.owner.query(api.tools.mine, page)).page[0].name).toBe(
      "Hand drill",
    );
    for (const input of [
      { ...listing, name: " " },
      { ...listing, name: "x".repeat(101) },
      { ...listing, description: "" },
      { ...listing, description: "x".repeat(501) },
    ])
      await expect(f.owner.mutation(api.tools.create, input)).rejects.toThrow();
    await expect(
      f.owner.mutation(api.tools.create, {
        ...listing,
        category: "invalid",
      } as never),
    ).rejects.toThrow();
    await f.owner.mutation(api.tools.remove, { toolId: f.toolId });
    expect((await f.owner.query(api.tools.mine, page)).page).toEqual([]);
    expect((await f.t.query(api.tools.listPublicAvailable, page)).page).toEqual(
      [],
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.toolId))).not.toBeNull();
  });
  it("returns exactly names/categories, filters today occupancy, and never leaks busy borrowers", async () => {
    const f = await fixture();
    const loanId = await f.request();
    expect((await f.t.query(api.tools.listPublicAvailable, page)).page).toEqual(
      [{ name: listing.name, category: listing.category }],
    );
    await f.owner.mutation(api.loans.transition, { loanId, action: "approve" });
    expect((await f.t.query(api.tools.listPublicAvailable, page)).page).toEqual(
      [],
    );
    const detail = await f.other.query(api.tools.detail, { toolId: f.toolId });
    expect(detail?.busy).toEqual([
      { startDate: "2026-10-31", endDate: "2026-11-02" },
    ]);
    expect(detail).not.toHaveProperty("borrowerId");
    expect(detail).not.toHaveProperty("ownerId");
    await f.owner.mutation(api.loans.transition, { loanId, action: "return" });
    expect(
      (await f.t.query(api.tools.listPublicAvailable, page)).page,
    ).toHaveLength(1);
    expect(
      (await f.owner.query(api.tools.list, { ...page, category: "garden" }))
        .page,
    ).toEqual([]);
  });
  it("does not invent availability before calendar initialization", async () => {
    const t = setup();
    expect((await t.query(api.tools.listPublicAvailable, page)).page).toEqual(
      [],
    );
  });
});
describe("Borrowing validation and atomic events", () => {
  it.each([
    ["2026-10-30", "2026-11-01"],
    ["2026-11-03", "2026-11-01"],
    ["2026-02-30", "2026-11-01"],
    ["2026-11-01T00:00:00Z", "2026-11-02"],
  ])(
    "rejects invalid range %s to %s without side effects",
    async (start, end) => {
      const f = await fixture();
      await expect(f.request(start, end)).rejects.toThrow();
      expect(await counts(f.t)).toEqual({ loans: 0, events: 0 });
    },
  );
  it("rejects own tools, duplicate requests, conflicting reservations and overdue tools", async () => {
    const f = await fixture();
    await expect(
      f.owner.mutation(api.loans.request, {
        toolId: f.toolId,
        startDate: "2026-10-31",
        endDate: "2026-11-02",
      }),
    ).rejects.toThrow();
    const loanId = await f.request();
    await expect(f.request()).rejects.toThrow();
    await f.owner.mutation(api.loans.transition, { loanId, action: "approve" });
    await expect(
      f.other.mutation(api.loans.request, {
        toolId: f.toolId,
        startDate: "2026-11-02",
        endDate: "2026-11-03",
      }),
    ).rejects.toThrow();
    vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
    await expect(
      f.other.mutation(api.loans.request, {
        toolId: f.toolId,
        startDate: "2026-12-01",
        endDate: "2026-12-03",
      }),
    ).rejects.toThrow();
    expect(await counts(f.t)).toEqual({ loans: 1, events: 2 });
  });
  it("keeps overlapping pending requests, but rechecks every approval", async () => {
    const f = await fixture(),
      first = await f.request(),
      second = await f.other.mutation(api.loans.request, {
        toolId: f.toolId,
        startDate: "2026-11-01",
        endDate: "2026-11-03",
      });
    await f.owner.mutation(api.loans.transition, {
      loanId: first,
      action: "approve",
    });
    await expect(
      f.owner.mutation(api.loans.transition, {
        loanId: second,
        action: "approve",
      }),
    ).rejects.toThrow();
    expect((await f.t.run((ctx) => ctx.db.get(second)))?.status).toBe(
      "pending",
    );
  });
  it("writes exactly one event for creation and each successful transition, with immutable snapshots", async () => {
    const f = await fixture(),
      loanId = await f.request();
    await f.owner.mutation(api.tools.edit, {
      toolId: f.toolId,
      ...listing,
      name: "Changed name",
    });
    for (const action of ["approve", "approve", "return", "return"] as const)
      await f.owner.mutation(api.loans.transition, { loanId, action });
    const events = await f.t.run((ctx) =>
      ctx.db.query("automationEvents").collect(),
    );
    expect(events.map((e) => e.type)).toEqual([
      "requested",
      "approved",
      "returned",
    ]);
    expect(events.map((e) => e.recipientId)).toEqual([
      f.ownerId,
      f.borrowerId,
      f.borrowerId,
    ]);
    for (const e of events) {
      expect(e.payload.toolName).toBe(listing.name);
      expect(e.state).toBe("pending");
      expect(e.attempts).toBe(0);
    }
  });
  it("permits future cancellation by either participant and decline by lender", async () => {
    const f = await fixture();
    let loanId = await f.request("2026-11-01", "2026-11-02");
    await f.borrower.mutation(api.loans.transition, {
      loanId,
      action: "cancel",
    });
    loanId = await f.request("2026-11-01", "2026-11-02");
    await f.owner.mutation(api.loans.transition, { loanId, action: "decline" });
    await f.owner.mutation(api.loans.transition, { loanId, action: "decline" });
    for (const actor of [f.borrower, f.owner]) {
      loanId = await f.request("2026-11-01", "2026-11-02");
      await f.owner.mutation(api.loans.transition, {
        loanId,
        action: "approve",
      });
      await expect(
        f.owner.mutation(api.loans.transition, { loanId, action: "return" }),
      ).rejects.toThrow();
      await actor.mutation(api.loans.transition, { loanId, action: "cancel" });
    }
  });
  it("rejects expired approval, cancelling a started loan and illegal terminal transitions", async () => {
    const f = await fixture(),
      loanId = await f.request();
    await expect(
      f.owner.mutation(api.loans.transition, { loanId, action: "return" }),
    ).rejects.toThrow();
    await f.owner.mutation(api.loans.transition, { loanId, action: "approve" });
    await expect(
      f.borrower.mutation(api.loans.transition, { loanId, action: "cancel" }),
    ).rejects.toThrow();
    await expect(
      f.owner.mutation(api.loans.transition, { loanId, action: "decline" }),
    ).rejects.toThrow();
    await f.owner.mutation(api.loans.transition, { loanId, action: "return" });
    await expect(
      f.owner.mutation(api.loans.transition, { loanId, action: "approve" }),
    ).rejects.toThrow();
    const second = await f.request();
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
    await expect(
      f.owner.mutation(api.loans.transition, {
        loanId: second,
        action: "approve",
      }),
    ).rejects.toThrow();
  });
});
describe("Removal preserves history", () => {
  it("rejects owner deletion with started loan, but admin removal keeps it returnable and closes future/pending requests", async () => {
    const f = await fixture(),
      started = await f.request("2026-10-31", "2026-10-31");
    await f.owner.mutation(api.loans.transition, {
      loanId: started,
      action: "approve",
    });
    const future = await f.request("2026-11-02", "2026-11-03");
    await f.owner.mutation(api.loans.transition, {
      loanId: future,
      action: "approve",
    });
    const pending = await f.other.mutation(api.loans.request, {
      toolId: f.toolId,
      startDate: "2026-11-05",
      endDate: "2026-11-06",
    });
    await expect(
      f.owner.mutation(api.tools.remove, { toolId: f.toolId }),
    ).rejects.toThrow();
    await f.admin.mutation(api.tools.remove, { toolId: f.toolId });
    await f.admin.mutation(api.tools.remove, { toolId: f.toolId });
    const states = await f.t.run(async (ctx) =>
      Promise.all([started, future, pending].map((id) => ctx.db.get(id))),
    );
    expect(states.map((l) => l?.status)).toEqual([
      "approved",
      "cancelled",
      "declined",
    ]);
    expect(await counts(f.t)).toEqual({ loans: 3, events: 7 });
    await expect(f.request("2026-11-08", "2026-11-09")).rejects.toThrow();
    await f.owner.mutation(api.loans.transition, {
      loanId: started,
      action: "return",
    });
    expect(
      (await f.owner.query(api.loans.list, { ...page, view: "incoming" })).page,
    ).toHaveLength(3);
  });
  it("allows owner removal with only future and pending loans", async () => {
    const f = await fixture(),
      loanId = await f.request("2026-11-01", "2026-11-02");
    await f.owner.mutation(api.loans.transition, { loanId, action: "approve" });
    await f.owner.mutation(api.tools.remove, { toolId: f.toolId });
    expect((await f.t.run((ctx) => ctx.db.get(loanId)))?.status).toBe(
      "cancelled",
    );
  });
});
describe("Calendar and timezone boundaries", () => {
  it("uses inclusive overlap and rejects normalized impossible dates", () => {
    expect(
      overlaps(
        { startDate: "2026-11-01", endDate: "2026-11-02" },
        { startDate: "2026-11-02", endDate: "2026-11-03" },
      ),
    ).toBe(true);
    expect(validDate("2028-02-29")).toBe(true);
    expect(validDate("2026-02-29")).toBe(false);
  });
  it.each([
    [
      "America/Sao_Paulo",
      "2026-11-01T02:59:00Z",
      "2026-10-31",
      "2026-11-01T03:00:00Z",
      "2026-11-01",
    ],
    [
      "America/New_York",
      "2026-11-01T05:59:00Z",
      "2026-11-01",
      "2026-11-01T06:00:00Z",
      "2026-11-01",
    ],
  ])(
    "refreshes calendar in %s across midnight or daylight saving",
    async (zone, before, oldDay, after, newDay) => {
      const f = await fixture();
      vi.stubEnv("APP_TIMEZONE", zone);
      vi.setSystemTime(new Date(before));
      await f.t.mutation(internal.clock.tick, {});
      expect((await f.t.query(api.clock.settings, {})).today).toBe(oldDay);
      const state = await f.t.run((ctx) =>
        ctx.db.query("systemState").unique(),
      );
      vi.setSystemTime(new Date(after));
      await f.t.mutation(internal.clock.tick, {});
      const latest = await f.t.run((ctx) =>
        ctx.db.query("systemState").unique(),
      );
      expect(latest?.today).toBe(newDay);
      expect(latest?._id).toBe(state?._id);
      expect(calendarDay(Date.now(), zone)).toBe(newDay);
    },
  );
  it("refreshes availability after midnight without writing a loan", async () => {
    const f = await fixture();
    vi.stubEnv("APP_TIMEZONE", "America/Sao_Paulo");
    const loanId = await f.request("2026-11-01", "2026-11-02");
    await f.owner.mutation(api.loans.transition, { loanId, action: "approve" });
    vi.setSystemTime(new Date("2026-11-01T02:59:00Z"));
    await f.t.mutation(internal.clock.tick, {});
    expect(
      (await f.t.query(api.tools.listPublicAvailable, page)).page,
    ).toHaveLength(1);
    const original = await f.t.run((ctx) => ctx.db.get(loanId));
    vi.setSystemTime(new Date("2026-11-01T03:00:00Z"));
    await f.t.mutation(internal.clock.tick, {});
    expect(
      (await f.t.query(api.tools.listPublicAvailable, page)).page,
    ).toHaveLength(0);
    expect(await f.t.run((ctx) => ctx.db.get(loanId))).toEqual(original);
  });
});

describe("Complete owner transition matrix", () => {
  const states = [
    "pending",
    "approved",
    "declined",
    "cancelled",
    "returned",
  ] as const;
  const actions = ["approve", "decline", "cancel", "return"] as const;
  for (const status of states)
    for (const action of actions)
      it(`${status} handles ${action} without an unintended event`, async () => {
        const f = await fixture(),
          loanId = await f.request("2026-11-01", "2026-11-02");
        await f.t.run((ctx) => ctx.db.patch(loanId, { status }));
        const target = {
          approve: "approved",
          decline: "declined",
          cancel: "cancelled",
          return: "returned",
        }[action];
        const noop = status === target;
        const legal =
          (status === "pending" &&
            (action === "approve" || action === "decline")) ||
          (status === "approved" && action === "cancel");
        if (noop || legal)
          await f.owner.mutation(api.loans.transition, { loanId, action });
        else
          await expect(
            f.owner.mutation(api.loans.transition, { loanId, action }),
          ).rejects.toThrow();
        expect((await counts(f.t)).events).toBe(legal ? 2 : 1);
      });
  it("keeps a future reservation publicly available today and blocks it once overdue", async () => {
    const f = await fixture(),
      loanId = await f.request("2026-11-01", "2026-11-02");
    await f.owner.mutation(api.loans.transition, { loanId, action: "approve" });
    expect(
      (await f.t.query(api.tools.listPublicAvailable, page)).page,
    ).toHaveLength(1);
    vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
    await f.t.mutation(internal.clock.tick, {});
    expect((await f.t.query(api.tools.listPublicAvailable, page)).page).toEqual(
      [],
    );
  });
});

describe("Borrower transition permissions remain enforced on repeats", () => {
  for (const status of [
    "pending",
    "approved",
    "declined",
    "cancelled",
    "returned",
  ] as const)
    for (const action of ["approve", "decline", "cancel", "return"] as const)
      it(`${status} restricts borrower ${action}`, async () => {
        const f = await fixture(),
          loanId = await f.request("2026-11-01", "2026-11-02");
        await f.t.run((ctx) => ctx.db.patch(loanId, { status }));
        const legal =
          action === "cancel" &&
          (status === "pending" || status === "approved");
        const noop = action === "cancel" && status === "cancelled";
        if (legal || noop)
          await f.borrower.mutation(api.loans.transition, { loanId, action });
        else
          await expect(
            f.borrower.mutation(api.loans.transition, { loanId, action }),
          ).rejects.toThrow();
        expect((await counts(f.t)).events).toBe(legal ? 2 : 1);
      });
});

it("bounds and orders busy-date projections without revealing borrowers", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    for (let i = 51; i > 0; i--) {
      const date = new Date(Date.UTC(2026, 10, i)).toISOString().slice(0, 10);
      await ctx.db.insert("loans", {
        toolId: f.toolId,
        lenderId: f.ownerId,
        borrowerId: f.borrowerId,
        toolNameSnapshot: listing.name,
        startDate: date,
        endDate: date,
        status: "approved",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  });
  const result = await f.borrower.query(api.tools.detail, { toolId: f.toolId });
  expect(result?.busy).toHaveLength(50);
  expect(result?.hasMoreBusyRanges).toBe(true);
  expect(result?.busy[0]).toEqual({
    startDate: "2026-11-01",
    endDate: "2026-11-01",
  });
});

it("treats a malformed tool link as not found", async () => {
  const { borrower } = await fixture();
  expect(await borrower.query(api.tools.detail, { toolId: "not-an-id" })).toBe(
    null,
  );
});

it("shows each side of a loan the other participant's name, and admins both", async () => {
  const { owner, borrower, admin, request } = await fixture();
  await request();
  const incoming = await owner.query(api.loans.list, {
    view: "incoming",
    ...page,
  });
  expect(incoming.page[0].otherPartyName).toBe("Sam");
  const mine = await borrower.query(api.loans.list, {
    view: "borrowing",
    ...page,
  });
  expect(mine.page[0].otherPartyName).toBe("Alex");
  const all = await admin.query(api.admin.loans, page);
  expect(all.page[0]).toMatchObject({
    lenderName: "Alex",
    borrowerName: "Sam",
  });
  const lenders = await admin.query(api.admin.lenders, page);
  const alex = lenders.page.find((u) => u.displayName === "Alex");
  expect(alex?.listingNames).toEqual(["Cordless drill"]);
});

it("formats date ranges without shifting days across timezones", () => {
  expect(formatRange("2026-11-02", "2026-11-04")).toBe("Nov 2 to Nov 4, 2026");
  expect(formatRange("2026-12-30", "2027-01-02")).toBe(
    "Dec 30, 2026 to Jan 2, 2027",
  );
  expect(formatRange("2026-11-02", "2026-11-02")).toBe("Nov 2, 2026");
});
