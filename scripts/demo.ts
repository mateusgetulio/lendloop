import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import {
  chromium,
  expect,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { openBrowserChecks } from "./browser.ts";
const exec = promisify(execFile);
assert.equal(process.version, "v22.22.0");
process.loadEnvFile(".env");
process.loadEnvFile(".env.local");
assert(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.NEXT_PUBLIC_CONVEX_URL!).hostname,
  ),
);
async function command(file: string, args: string[]) {
  try {
    return (await exec(file, args, { maxBuffer: 32 * 1024 * 1024 })).stdout;
  } catch {
    throw new Error(
      `${file} failed during recording. Check the local services without printing private values.`,
    );
  }
}
async function cli<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return JSON.parse(
    (
      await command("npx", ["convex", "run", name, JSON.stringify(args)])
    ).trim() || "null",
  );
}
async function envGet(name: string) {
  try {
    return (
      (await command("npx", ["convex", "env", "get", name])).trim() || undefined
    );
  } catch {
    return undefined;
  }
}
async function envSet(name: string, value: string | undefined) {
  await command("npx", [
    "convex",
    "env",
    ...(value === undefined ? ["remove", name] : ["set", name, value]),
  ]);
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(read: () => Promise<T>, match: (value: T) => boolean) {
  for (let i = 0; i < 60; i++) {
    const value = await read();
    if (match(value)) return value;
    await pause(500);
  }
  throw new Error("Recording timed out waiting for real delivery.");
}
async function rows<T>(table: string) {
  return JSON.parse(
    await command("npx", [
      "convex",
      "data",
      table,
      "--limit",
      "1000",
      "--format",
      "json",
    ]),
  ) as T[];
}
type Event = { _id: string; loanId: string; state: string };
type Loan = { _id: string; toolId: string; status: string };
type Note = {
  loanId: string;
  kind: string;
  n8nExecutionId: string;
  message: string;
};
const saved = {
  enabled: await envGet("DEMO_SEED_ENABLED"),
  backoff: await envGet("AUTOMATION_BACKOFF_SECONDS"),
};
await mkdir("test-results/video", { recursive: true });
const accounts = await openBrowserChecks(cli);
const browser = await chromium.launch({ headless: true });
const clips: { path: string; start: number; duration: number }[] = [];
let sceneNumber = 0;
async function scene(
  role: string,
  url: string,
  caption: string,
  action?: (page: Page) => Promise<void>,
  hold = 1800,
) {
  const state =
    role === "public"
      ? undefined
      : role === "workflow"
        ? JSON.parse(
            await readFile("test-results/video/n8n-state.json", "utf8"),
          )
        : await accounts.session(role).context.storageState();
  const context: BrowserContext = await browser.newContext({
    storageState: state,
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: "test-results/video/raw",
      size: { width: 1280, height: 720 },
    },
  });
  const began = Date.now();
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForTimeout(700);
  if (role !== "workflow")
    await page.getByRole("heading", { level: 1 }).waitFor();
  await page.evaluate((text) => {
    const box = document.createElement("div");
    box.textContent = text;
    box.style.cssText =
      "position:fixed;left:0;right:0;top:0;padding:18px 24px;background:#171738;color:#F9FBFF;font:600 20px/1.4 system-ui;z-index:2147483647;pointer-events:none";
    box.id = "recording-caption";
    document.body.append(box);
  }, caption);
  const start = (Date.now() - began) / 1000;
  await pause(700);
  if (action) await action(page);
  await pause(hold);
  const duration = (Date.now() - began) / 1000 - start;
  const video = page.video()!;
  await context.close();
  clips.push({ path: await video.path(), start, duration });
  sceneNumber++;
  console.log(`Recorded scene ${sceneNumber}.`);
}
async function workflowSession() {
  let state;
  try {
    state = JSON.parse(
      await readFile("test-results/video/n8n-state.json", "utf8"),
    );
  } catch {}
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();
  await page.goto("http://localhost:5678");
  await pause(800);
  if (
    await page.getByRole("button", { name: "Next", exact: true }).isVisible()
  ) {
    const password = "D3mo!" + randomBytes(20).toString("hex");
    await page
      .getByLabel("Email", { exact: false })
      .fill("local-demo@example.com");
    await page.getByLabel("First Name", { exact: false }).fill("Local");
    await page.getByLabel("Last Name", { exact: false }).fill("Demo");
    await page.getByLabel("Password", { exact: false }).fill(password);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await pause(1000);
    await writeFile(
      "test-results/video/n8n-owner.json",
      JSON.stringify({ email: "local-demo@example.com", password }),
      { mode: 0o600 },
    );
  } else if (
    await page.getByRole("button", { name: "Sign in", exact: true }).isVisible()
  ) {
    let credentials;
    try {
      credentials = JSON.parse(
        await readFile("test-results/video/n8n-owner.json", "utf8"),
      );
    } catch {
      credentials = {
        email: process.env.N8N_DEMO_EMAIL,
        password: process.env.N8N_DEMO_PASSWORD,
      };
    }
    assert(
      credentials.email && credentials.password,
      "Provide N8N_DEMO_EMAIL and N8N_DEMO_PASSWORD for the dedicated local owner account.",
    );
    await page.getByLabel("Email", { exact: false }).fill(credentials.email);
    await page
      .getByLabel("Password", { exact: false })
      .fill(credentials.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await pause(1000);
  }
  await context.storageState({ path: "test-results/video/n8n-state.json" });
  await context.close();
}
try {
  await workflowSession();
  const seedArgs = {
    lenderId: accounts.actors.lender,
    borrowerId: accounts.actors.borrower,
  };
  await envSet("DEMO_SEED_ENABLED", "false");
  await assert.rejects(() => cli("seed:demo", seedArgs));
  await envSet("DEMO_SEED_ENABLED", "true");
  type Seed = {
    businessDate: string;
    entries: {
      scenario: string;
      toolId: string;
      loanId: string | null;
      created: boolean;
    }[];
  };
  const seed = await cli<Seed>("seed:demo", seedArgs),
    repeated = await cli<Seed>("seed:demo", seedArgs);
  assert.deepEqual(
    repeated.entries.map((e) => e.toolId),
    seed.entries.map((e) => e.toolId),
  );
  assert(repeated.entries.every((e) => !e.created));
  await envSet("DEMO_SEED_ENABLED", saved.enabled);
  const date = seed.businessDate,
    next = new Date(new Date(date + "T12:00:00Z").getTime() + 86400000)
      .toISOString()
      .slice(0, 10);
  const available = seed.entries.find((e) => e.scenario === "available")!,
    returned = seed.entries.find((e) => e.scenario === "returned")!,
    overdue = seed.entries.find((e) => e.scenario === "overdue")!;
  await until(
    () => rows<Event>("automationEvents"),
    (all) =>
      all
        .filter((e) => seed.entries.some((s) => s.loanId === e.loanId))
        .every((e) => e.state === "delivered"),
  );
  await scene(
    "public",
    "http://localhost:3000/",
    "LendLoop: available tools, with only name and category shown publicly.",
  );
  async function request(page: Page) {
    await page.getByLabel("Start date", { exact: true }).fill(date);
    await page.getByLabel("End date", { exact: true }).fill(next);
    await page
      .getByRole("button", { name: "Request to borrow", exact: true })
      .click();
    await expect(
      page.getByText("Request sent.", { exact: false }),
    ).toBeVisible();
  }
  await scene(
    "borrower",
    `http://localhost:3000/tools/${available.toolId}`,
    "A neighbor requests the available Step ladder.",
    request,
  );
  await scene(
    "lender",
    "http://localhost:3000/incoming",
    "The lender approves the request. Dates are checked again on the backend.",
    async (page) => {
      const card = page.locator("li.card").filter({
        has: page.getByRole("heading", { name: "Step ladder", exact: true }),
      });
      await card.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Request approved." }),
      ).toBeVisible();
    },
  );
  const requestedLoans = await rows<Loan>("loans");
  const requestedLoan = requestedLoans.find(
    (loan) => loan.toolId === available.toolId,
  )!;
  const approval = await until(
    () => rows<Note>("notifications"),
    (all) =>
      all.some((n) => n.kind === "approved" && n.loanId === requestedLoan._id),
  );
  const approvalNote = approval.find(
    (n) => n.kind === "approved" && n.loanId === requestedLoan._id,
  )!;
  await scene(
    "borrower",
    "http://localhost:3000/notifications",
    "The signed workflow callback creates the borrower's approval notification.",
    async (page) => {
      await expect(
        page.getByText(approvalNote.message, { exact: true }),
      ).toBeVisible();
    },
  );
  await scene(
    "workflow",
    `http://localhost:5678/workflow/LendLoopNotify/executions/${approvalNote.n8nExecutionId}`,
    "The matching n8n execution completed successfully.",
    async (page) => {
      await expect(page.locator("body")).toContainText("Succeeded");
    },
    2500,
  );
  await envSet("AUTOMATION_BACKOFF_SECONDS", "1,1,1,1,1");
  await command("docker", ["compose", "stop", "n8n"]);
  await scene(
    "borrower",
    `http://localhost:3000/tools/${returned.toolId}`,
    "With n8n stopped, another request still saves safely.",
    request,
  );
  const recoveryLoan = (await rows<Loan>("loans")).find(
    (loan) => loan.toolId === returned.toolId && loan.status === "pending",
  )!;
  const failed = await until(
    async () => {
      await cli("automation:sweep");
      return rows<Event>("automationEvents");
    },
    (all) =>
      all.some((e) => e.loanId === recoveryLoan._id && e.state === "failed"),
  );
  const failedEvent = failed.find(
    (e) => e.loanId === recoveryLoan._id && e.state === "failed",
  )!;
  await scene(
    "admin",
    "http://localhost:3000/admin",
    "After five attempts, the administrator can see the failed notification.",
    async (page) => {
      await page
        .getByRole("heading", { name: "Automation", exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        page.getByRole("button", {
          name: "Retry notification for Kitchen mixer",
          exact: true,
        }),
      ).toBeVisible();
    },
  );
  await command("docker", ["compose", "start", "n8n"]);
  await until(async () => {
    try {
      return (await fetch("http://localhost:5678/healthz/readiness")).ok;
    } catch {
      return false;
    }
  }, Boolean);
  await scene(
    "admin",
    "http://localhost:3000/admin",
    "After restart, Retry reuses the same event and delivery key.",
    async (page) => {
      const retry = page.getByRole("button", {
        name: "Retry notification for Kitchen mixer",
        exact: true,
      });
      await retry.scrollIntoViewIfNeeded();
      await retry.click();
      await expect(
        page.getByText("Notification queued for retry.", { exact: true }),
      ).toBeVisible();
      await until(
        () => rows<Event>("automationEvents"),
        (all) =>
          all.some((e) => e._id === failedEvent._id && e.state === "delivered"),
      );
    },
  );
  await scene(
    "lender",
    "http://localhost:3000/notifications",
    "The recovered request arrives once in the lender's notifications.",
    async (page) => {
      await expect(
        page
          .locator(".loan-list .card")
          .filter({ hasText: "New request to borrow Kitchen mixer" }),
      ).toHaveCount(1);
    },
  );
  for (const broker of [5680, 5681])
    await command("docker", [
      "compose",
      "exec",
      "-T",
      "-e",
      `N8N_RUNNERS_BROKER_PORT=${broker}`,
      "n8n",
      "n8n",
      "execute",
      "--id=LendLoopOverdue",
    ]);
  const reminders = (await rows<Note>("notifications")).filter(
    (n) => n.loanId === overdue.loanId && n.kind === "overdue",
  );
  assert.equal(reminders.length, 1);
  await scene(
    "workflow",
    "http://localhost:5678/workflow/LendLoopOverdue/executions",
    "Two successful reminder runs use the same daily deduplication key.",
    undefined,
    2200,
  );
  await scene(
    "borrower",
    "http://localhost:3000/notifications",
    "Only one overdue reminder for Community drill, even after both runs.",
    async (page) => {
      await expect(
        page.getByText(reminders[0].message, { exact: true }),
      ).toHaveCount(1);
    },
    2500,
  );
  await writeFile("test-results/video/clips.json", JSON.stringify(clips));
  const metadata = JSON.parse(
    await command("node", [
      "scripts/trim-video.mjs",
      "test-results/video/clips.json",
      "docs/demo.mp4",
    ]),
  );
  await writeFile(
    "test-results/video/result.json",
    JSON.stringify(
      {
        duration: metadata.duration,
        bytes: metadata.bytes,
        scenes: sceneNumber,
        reminderRows: reminders.length,
        seedIdempotent: true,
        failedEventDelivered: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "Silent captioned recording saved within duration and size limits.",
  );
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message.replaceAll(process.env.CLERK_SECRET_KEY!, "[redacted]")
      : "Recording failed.",
  );
  process.exitCode = 1;
} finally {
  await command("docker", ["compose", "start", "n8n"]);
  await envSet("AUTOMATION_BACKOFF_SECONDS", saved.backoff);
  await envSet("DEMO_SEED_ENABLED", saved.enabled);
  await browser.close();
  await accounts.cleanup();
}
