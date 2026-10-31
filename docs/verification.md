# Verification

Date: 2026-10-31. The application now supports tool listings, borrowing requests, ownership rules, administrator controls and calendar refresh. Automation events are recorded atomically, but dispatch, notification persistence, reminders and automation monitoring are not implemented.

## Environment and versions

Checks used Node 22.22.0 and npm 10.9.4. The lockfile is only changed with this exact pair.

| Component               | Version                         |
| ----------------------- | ------------------------------- |
| Next.js                 | 16.4.3                          |
| React / React DOM       | 19.2.3                          |
| TypeScript              | 5.9.3                           |
| Convex client/CLI       | 1.49.0                          |
| Clerk Next.js SDK       | 7.9.23                          |
| n8n image               | `n8nio/n8n:2.45.7`              |
| Vitest / Vite           | 5.0.5 / 8.3.5                   |
| Convex test harness     | 0.0.66                          |
| Playwright test tooling | 1.64.1                          |
| Chromium                | Chrome for Testing 156.0.8078.4 |
| Gitleaks                | 8.30.1                          |

Browser and integration checks ran on macOS arm64, with Docker through OrbStack. The running backend and Docker timezone were set to `America/Sao_Paulo`. No production credentials were used. Linux service networking, Safari and Firefox were not exercised.

## Core backend checks

The automated suite exercises public functions through authenticated test identities and accesses stored records to confirm transaction outcomes. It does not claim to reproduce real transaction-conflict scheduling.

| Check                                                                                                                                             | Result |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| New account provisioning uses the verified identity, defaults to user, provides a name fallback and is idempotent                                 | Pass   |
| Anonymous requests cannot invoke authenticated reads or writes                                                                                    | Pass   |
| A caller cannot supply another actor, owner or role through public arguments                                                                      | Pass   |
| Foreign listing edits/deletion and unrelated loan actions are rejected on the backend                                                             | Pass   |
| Administrators cannot edit someone else's listing or approve someone else's loan merely because of their role                                     | Pass   |
| Personal listings, borrowing and incoming queries isolate records by participant                                                                  | Pass   |
| Ordinary users cannot invoke admin loan views, user views or trust toggles                                                                        | Pass   |
| Name, description, category, condition and calendar-date inputs are validated                                                                     | Pass   |
| Borrowing one's own tool, invalid/past dates, duplicate requests, approved-date overlap and overdue tools are rejected without extra loans/events | Pass   |
| Overlapping pending requests coexist, but conflicting approval fails                                                                              | Pass   |
| Request creation and successful transitions write one pending event with the correct recipient and immutable name snapshot                        | Pass   |
| Repeated completed transitions write no additional event                                                                                          | Pass   |
| Every owner transition/status combination either succeeds, safely repeats or rejects without an unintended event                                  | Pass   |
| Borrower cancellation and lender confirmation obey status and date restrictions                                                                   | Pass   |
| Owners cannot remove a listing with a started loan                                                                                                | Pass   |
| Admin removal preserves a started loan, cancels future reservations, declines pending requests and preserves return access                        | Pass   |
| Public results contain exactly name/category and omit occupied/overdue/removed tools                                                              | Pass   |
| Tool details reveal at most 50 ordered approved date ranges, disclose truncation, and omit borrower identity                                      | Pass   |
| Missing calendar state produces no invented public availability                                                                                   | Pass   |
| Calendar refresh changes availability without modifying loans                                                                                     | Pass   |
| Non-UTC midnight and daylight-saving boundaries use the configured timezone                                                                       | Pass   |

`npm test` passed 82 checks: 66 core checks and 16 contrast checks. CI runs this on every push.

## Real Clerk authentication

`node scripts/check-clerk.mjs` now uses `users:current` and `users:ensureCurrent`.

The live check confirmed anonymous access has no identity, a real Clerk-issued session token authenticates with the configured audience, a local profile is provisioned with a display name, and a modified token does not authenticate. Its temporary Clerk account and sessions were deleted. Local synthetic profile records remain because account deletion is outside the implemented functionality.

Separately, real Chromium contexts signed in through Clerk's email-code interface as two ordinary accounts and one account promoted through the internal administrator operation. Test email addresses used Clerk's reserved development-code behavior. A Clerk testing token was used only to avoid bot challenges; it did not replace the email-code sign-in flow. Keys and session tokens were never printed.

## Live browser behavior

The following flows passed against the actual backend through Chromium:

- Create a listing, edit it, and save it with text preserved.
- Borrow as another signed-in user, approve as the lender, and confirm return.
- Open each personal view and confirm the expected request and listing records.
- Filter categories, recover from an empty result, and use Back with the filter retained in the URL.
- Open the administrator view, see all loans, change the actual lender's Trusted Lender status, and see its badge as the borrower.
- Refuse owner deletion while a started loan exists.
- Remove that listing as an administrator, decline its pending request, cancel its future approved reservation, and confirm return of its preserved started loan.
- Create and delete an ordinary listing through keyboard-operated controls and confirmation.
- Open a confirmation with Enter and cancel it with Escape without performing the destructive action.
- Sign in through the email-code interface at 320 px using keyboard actions.

A further live backend check used tokens from the browser sessions to call public functions directly. Foreign edits/removals, admin edits of foreign listings, borrower and unrelated-admin approval, ordinary access to all loans, attempted client promotion and actor injection were rejected. Its synthetic listing was removed by its owner.

## Public response inspection

A raw anonymous `tools:listPublicAvailable` response was captured while a returned tool was publicly available. Its page was exactly:

```json
[{ "category": "power_tools", "name": "Neighborhood drill" }]
```

Each object's sorted keys were asserted equal to `category` and `name`. No owner, local document identifier, description, condition, dates or loan records were present. The full response also carries an opaque pagination cursor.

## Screen and keyboard checks

Every destination was opened at 320 px and 1280 px as both ordinary accounts and the administrator: public landing page, catalog, tool detail/request form, listings, borrowing requests, incoming requests, and administrator access or its denied state. New-listing forms were also checked at both widths. This covered 42 destination renders plus form and sign-in checks.

Measurements found no horizontal document overflow, no app control smaller than 44 by 44 CSS pixels, and no screen with more than one primary action. Inline prose links are exempt from target-size measurement, matching the documented decision. Card-heading links and third-party sign-in controls were enlarged when measurements found smaller targets.

Keyboard traversal was exercised on every destination at both widths. A separate phone-width run checked 40 Tab positions per destination/account combination and found no focused control obscured by the fixed bottom navigation. Scroll padding and control scroll margins reserve room for it. Editing, form submission, request approval, return, removal, category navigation and dialog cancellation were exercised with keyboard actions. This is browser automation, not a screen-reader evaluation or a usability study.

Screenshots were captured and inspected for phone catalog, date form, listing form, administration and sign-in, plus desktop catalog, listing form and administration. The layout uses one/two/three catalog columns, a capped page width, stacked admin rows at phone width, persistent phone navigation, native dates, visible labels, text statuses, local field errors, status announcements, system fonts and the documented color palette.

No unresolved mismatch with the documented app layout or target-size decisions was observed in these checks. Physical iOS date-input behavior, zoom, screen-reader announcements, forced-colors mode and real usability testing remain unverified. Clerk retains its own functional icons and provider branding inside its sign-in component; the app itself adds no decorative icons or emoji.

## Real-use checks

These came from walking through the app as each person, on top of the automated checks:

- Leaving an empty field alone shows no error. Submitting shows both date errors, and a filled-in invalid field shows its error on leaving it.
- A lender sees who is asking, and a borrower sees who is lending.
- The admin loan table shows lender and borrower, and marks overdue loans as Overdue.
- Accounts with the same `Neighbor` name can be told apart by their active tools, with no internal IDs on screen.
- A malformed tool link shows "Tool unavailable" instead of an error page.
- Escape closes the More menu.

All accounts in these checks showed as `Neighbor`, because Clerk session tokens carry no name by default. Adding a name claim is documented in the README but has not been tested.

## Timezone checks

The actual backend ran with `APP_TIMEZONE=America/Sao_Paulo`. Its settings query supplied that timezone to the request form. Requests and transitions completed successfully under it. Automated checks crossed the local midnight boundary and the New York daylight-saving fallback boundary with controlled clocks. Calendar state and public availability updated without a loan write. The clock job runs each minute and only changes the stored day when necessary. Health checking is not implemented.

## Integration proof

The signed round-trip action, HTTP probes and nine rejection cases per receiver are still temporary. The signing checks and the round trip started from inside Convex were run again after the product changes.

These probes do not dispatch pending events or create product notifications. They remain temporary integration code. The overdue export is inactive. Workflow exports contain neither `pinData` nor credential values.

## Quality and limitations

A clean Linux container passed `npm ci`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build` and `npm run check:workflows` using Node 22.22.0/npm 10.9.4 and only `.env.ci` values. Compose validation passed separately. Production compilation passes with fictional public Clerk configuration and a placeholder backend URL, without a secret key. Dependency audit reports moderate lint-tool findings; it is not a production security guarantee.

Gitleaks passed on the full Git history. Local environment secret values were also searched for in every committed file, without printing them. Runtime environment files remain ignored.

Duplicate detection covers overlapping borrow requests. Separate identical-looking listings can represent distinct physical items and are not deduplicated; the form prevents in-flight repeat submissions. No general create-listing idempotency guarantee is claimed.

Not claimed: real concurrent approvals, durable notification delivery, reminders, automation error visibility in the admin UI, a repeatable seed, a full fresh-clone walkthrough, production hosting, or complete accessibility conformance. These require additional implementation or separate verification. A green CI badge alone does not cover browser authentication or running-service behavior.
