import {
  chromium,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
type Command = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
export type BrowserChecks = Awaited<ReturnType<typeof openBrowserChecks>>;
export async function openBrowserChecks(command: Command) {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret?.startsWith("sk_test_"))
    throw new Error(
      "A Clerk development app is required for browser verification.",
    );
  const users: { id: string; localId: string; role: string; email: string }[] =
    [];
  async function clerk(path: string, body: unknown = {}, method = "POST") {
    const response = await fetch(`https://api.clerk.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      ...(method === "DELETE" ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(
        `Clerk development verification returned HTTP ${response.status}.`,
      );
    return await response.json();
  }
  const browser: Browser = await chromium.launch({ headless: true });
  const sessions = new Map<string, { page: Page; context: BrowserContext }>();
  async function close() {
    await browser.close();
    for (const user of users) await clerk(`/users/${user.id}`, {}, "DELETE");
  }
  try {
    const { token } = await clerk("/testing_tokens");
    for (const role of ["lender", "borrower", "admin"]) {
      const email = `ll-${role}-${randomUUID().slice(0, 8)}+clerk_test@example.com`,
        user = await clerk("/users", {
          email_address: [email],
          skip_password_requirement: true,
        });
      const record = { id: user.id, localId: "", role, email };
      users.push(record);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      await context.route(
        process.env.CLERK_JWT_ISSUER_DOMAIN + "/**",
        async (route) => {
          const url = new URL(route.request().url());
          url.searchParams.set("__clerk_testing_token", token);
          await route.continue({ url: url.toString() });
        },
      );
      const page = await context.newPage();
      sessions.set(role, { context, page });
      await page.goto("http://localhost:3000/");
      await page
        .getByRole("button", { name: "Sign in to lend or borrow", exact: true })
        .click();
      await page.getByLabel("Email address", { exact: false }).fill(email);
      const codePrepared = page.waitForResponse(
        (response) =>
          response.url().includes("/prepare_first_factor") &&
          response.request().method() === "POST" &&
          response.ok(),
      );
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await codePrepared;
      await page
        .getByRole("textbox", { name: "Enter verification code" })
        .fill("424242");
      const cont = page.getByRole("button", { name: "Continue", exact: true });
      if (await cont.isVisible())
        await cont.click({ timeout: 2000 }).catch(() => {});
      await expect(
        page.getByRole("link", { name: "Browse tools", exact: true }),
      ).toBeVisible({ timeout: 20000 });
      await page.goto("http://localhost:3000/tools");
      const client = await clientFor(page);
      const result = await client.query(
        makeFunctionReference<"query">("users:current"),
        {},
      );
      if (!result.user)
        throw new Error("Browser account provisioning did not complete.");
      record.localId = result.user._id;
    }
    await command("admin:promote", {
      userId: users.find((u) => u.role === "admin")!.localId,
    });
    await sessions.get("admin")!.page.reload();
  } catch (error) {
    await mkdir("test-results/ui", { recursive: true });
    for (const [role, session] of sessions)
      await session.page
        .screenshot({
          path: `test-results/ui/sign-in-${role}.png`,
          fullPage: true,
        })
        .catch(() => {});
    await close();
    throw error;
  }
  async function clientFor(page: Page) {
    await page.waitForFunction(() =>
      Boolean(
        (window as unknown as { Clerk?: { session?: unknown } }).Clerk?.session,
      ),
    );
    const jwt = await page.evaluate(async () => {
      const c = (
        window as unknown as {
          Clerk: { session: { getToken: () => Promise<string> } };
        }
      ).Clerk;
      return c.session.getToken();
    });
    const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!, {
      logger: false,
    });
    client.setAuth(jwt);
    return client;
  }
  return {
    actors: {
      lender: users[0].localId,
      borrower: users[1].localId,
      other: users[2].localId,
      admin: users[2].localId,
    },
    async retry(toolName: string) {
      const page = sessions.get("admin")!.page;
      await page.goto("http://localhost:3000/admin");
      const region = page.getByRole("region", { name: "Automation" });
      const button = region.getByRole("button", {
        name: `Retry notification for ${toolName}`,
        exact: true,
      });
      await expect(
        region.getByRole("heading", {
          name: "Failed notifications",
          exact: true,
        }),
      ).toBeVisible({ timeout: 15000 });
      for (let i = 0; i < 30 && !(await button.isVisible()); i++) {
        const more = region
          .getByRole("button", { name: "Load more", exact: true })
          .first();
        if (!(await more.isVisible())) break;
        await more.click();
        await page.waitForTimeout(300);
      }
      await expect(button).toBeVisible({ timeout: 15000 });
      await button.focus();
      await page.keyboard.press("Enter");
      await expect(region.getByRole("status")).toHaveText(
        "Notification queued for retry.",
      );
    },
    async notifications() {
      const page = sessions.get("lender")!.page;
      await page.goto("http://localhost:3000/notifications");
      await expect(
        page.getByRole("heading", { name: "Notifications", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".loan-list .card").first()).toBeVisible({
        timeout: 15000,
      });
    },
    async ordering() {
      const client = await clientFor(sessions.get("lender")!.page);
      return client.query(
        makeFunctionReference<"query">("notifications:list"),
        { paginationOpts: { numItems: 50, cursor: null } },
      );
    },
    async inspect() {
      await mkdir("test-results/ui", { recursive: true });
      const measured = [];
      for (const width of [320, 1280])
        for (const role of ["borrower", "lender", "admin"]) {
          const { page } = sessions.get(role)!;
          await page.setViewportSize({ width, height: 900 });
          for (const path of ["/notifications", "/admin"]) {
            await page.goto("http://localhost:3000" + path);
            await page.getByRole("heading", { level: 1 }).waitFor();
            await page.waitForTimeout(300);
            if (width === 320) {
              const more = page.getByRole("button", {
                name: "More",
                exact: true,
              });
              await more.focus();
              await page.keyboard.press("Enter");
              await expect(
                page
                  .locator("#account-menu")
                  .getByRole("link", { name: "Notifications", exact: true }),
              ).toBeVisible();
              await page.keyboard.press("Escape");
              expect(await page.locator(".phone-nav a").count()).toBe(4);
            }
            const geometry = await page.evaluate(() => ({
              overflow: document.documentElement.scrollWidth > innerWidth,
              small: [
                ...document.querySelectorAll("button,input,select,textarea,a"),
              ]
                .filter((el) => {
                  const r = el.getBoundingClientRect();
                  return (
                    r.width &&
                    r.height &&
                    getComputedStyle(el).visibility !== "hidden" &&
                    !(el.tagName === "A" && el.closest("p"))
                  );
                })
                .filter((el) => {
                  const r = el.getBoundingClientRect();
                  return r.width < 44 || r.height < 44;
                }).length,
            }));
            expect(geometry).toEqual({ overflow: false, small: 0 });
            for (let i = 0; i < 40; i++) {
              await page.keyboard.press("Tab");
              const hidden = await page.evaluate(() => {
                const el = document.activeElement;
                if (!el || el === document.body) return false;
                const r = el.getBoundingClientRect(),
                  nav = document
                    .querySelector(".phone-nav")
                    ?.getBoundingClientRect();
                return (
                  r.top < 0 ||
                  r.right > innerWidth + 1 ||
                  r.bottom > innerHeight + 1 ||
                  Boolean(
                    nav &&
                    nav.height &&
                    r.bottom > nav.top + 1 &&
                    r.top < nav.bottom &&
                    !el.closest(".phone-nav"),
                  )
                );
              });
              expect(hidden).toBe(false);
            }
            await page.evaluate(() => {
              (document.activeElement as HTMLElement)?.blur();
              window.scrollTo(0, 0);
            });
            await page.screenshot({
              path: `test-results/ui/${role}-${width}-${path.slice(1)}.png`,
              fullPage: true,
            });
            if (role === "admin" && path === "/admin") {
              for (const [name, heading] of [
                ["automation", "Automation"],
                ["failures", "Recorded workflow failures"],
              ]) {
                await page
                  .getByRole("heading", { name: heading, exact: true })
                  .scrollIntoViewIfNeeded();
                await page.screenshot({
                  path: `test-results/ui/admin-${width}-${name}.png`,
                });
              }
            }
            measured.push({ role, width, path, ...geometry });
          }
        }
      return measured;
    },
    async failureVisible(message: string) {
      const page = sessions.get("admin")!.page;
      await page.goto("http://localhost:3000/admin");
      await expect(
        page
          .getByRole("region", { name: "Automation" })
          .getByText(message, { exact: true })
          .first(),
      ).toBeVisible();
    },
    async adminVisible() {
      const page = sessions.get("admin")!.page;
      await page.goto("http://localhost:3000/admin");
      await expect(
        page.getByRole("heading", {
          name: "Recorded workflow failures",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("region", { name: "Automation" })
          .getByText(
            "execution-failed: Workflow delivery failed. Inspect the private execution record.",
            { exact: true },
          )
          .first(),
      ).toBeVisible();
    },
    async cleanup() {
      await close();
    },
  };
}
