# Verification

Date: 2026-10-31. This records what was tested, how, and what was not. The results below come from a new clone of the public repository, set up by following the README, using its default `UTC` timezone. CI covers offline checks only.

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

## Clean clone run

A new clone of the public repository was set up by following the README in order: install, environment files, local Convex, `scripts/configure.mjs`, Docker n8n on an empty volume, `scripts/n8n-setup.sh`, then Next.js. The only temporary warning was the missing issuer before configuration, which the README describes. It used a separate Docker project and a new local Convex deployment.

`node scripts/check-clerk.mjs` and `npm run verify` then passed: 16 check groups with real Clerk browser sign-in, plus 48 screen measurements at 320 px and 1280 px with no sideways scrolling and no control under 44 by 44 CSS pixels. A second new clone recorded `docs/demo.mp4`, which is 45 seconds, silent and under 500 KB. The recording also checked the seed: it refuses without its flag, and a second run changes nothing.

## Acceptance scenarios

"Automated" means Vitest in CI. "Running stack" means `npm run verify` against real Clerk, Convex and n8n.

| #   | Scenario                                                                                                                                 | How it was checked                        | Result                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------- |
| 1   | The signed-out page shows branding, tagline, sign-in, and only tool names and categories                                                 | Running stack, demo recording             | Pass                       |
| 2   | Each item in the public response is exactly a name and a category                                                                        | Automated                                 | Pass                       |
| 3   | A user can create, edit and delete their own listing, and invalid input is rejected                                                      | Automated, running stack by keyboard      | Pass                       |
| 4   | Calling another user's functions directly is rejected                                                                                    | Automated                                 | Pass                       |
| 5   | Own tool, past date, duplicate request, overlap with an approved loan and a tool with an overdue loan are rejected with no loan or event | Automated                                 | Pass                       |
| 6   | Two parallel approvals of overlapping requests: exactly one succeeds                                                                     | Running stack, separate backend processes | Pass                       |
| 7   | Every illegal transition and repeat is rejected or does nothing, with no extra event                                                     | Automated                                 | Pass                       |
| 8   | Personal views and the category filter show the right records, with clear empty states                                                   | Automated, running stack                  | Pass                       |
| 9   | An admin can remove any listing, view all loans and toggle Trusted Lender, and a user cannot                                             | Automated, running stack                  | Pass                       |
| 10  | An owner cannot delete a listing with a started loan                                                                                     | Automated                                 | Pass                       |
| 11  | Admin removal with a started loan succeeds, the loan stays returnable, pending requests are declined and future loans cancelled          | Automated                                 | Pass                       |
| 12  | Crossing midnight, in a non-UTC timezone and across daylight saving, updates availability with no loan write                             | Automated                                 | Pass                       |
| 13  | Each transition delivers the right notification to the right person through n8n                                                          | Running stack, demo recording             | Pass                       |
| 14  | Tampered payload, wrong purpose and stale timestamp are rejected in both directions with no side effect                                  | Running stack                             | Pass                       |
| 15  | Unicode and escaped newlines verify, extra outer fields are rejected, and a substituted recipient has no effect                          | Running stack                             | Pass                       |
| 16  | Replayed webhooks and callbacks, and two reminder runs at once, leave one row per key                                                    | Running stack, demo recording             | Pass                       |
| 17  | With overdue, due today, future and returned loans, only the overdue one gets one reminder                                               | Running stack                             | Pass                       |
| 18  | With n8n stopped, a request saves, retries run, the failure shows in admin, and admin retry delivers after restart                       | Running stack, demo recording             | Pass                       |
| 19  | n8n accepts a request but its callback fails: the event stays pending and is delivered once later                                        | Running stack                             | Pass                       |
| 20  | With no callback after the fifth attempt, the event fails after the final delay, and a late valid callback settles it once               | Automated, running stack                  | Pass                       |
| 21  | Dispatch and sweep racing use one attempt, and delivered state is never overwritten                                                      | Automated, running stack                  | Pass                       |
| 22  | After a partial reminder failure, the next run sends only what is missing and the failure is reported                                    | Running stack                             | Pass                       |
| 23  | Several pages, already-sent loans and an empty filtered page skip no candidate, and the page cap reports a failure                       | Running stack                             | Pass                       |
| 24  | With workflow B disabled and nothing overdue, `reminder-run-missing` appears in admin                                                    | Automated, running stack                  | Pass                       |
| 25  | A return racing a reminder is correct in both commit orders                                                                              | Automated, running stack                  | Pass                       |
| 26  | An approval delivered before its request event keeps both, in order of occurrence, with the right status                                 | Automated, running stack                  | Pass                       |
| 27  | Source and workflow exports contain no secrets or real personal data                                                                     | Running stack, Gitleaks in CI             | Pass                       |
| 28  | A fresh clone following the README runs the app and three workflows with no undocumented step                                            | New clone, described above                | Pass, with the limit below |
| 29  | A failure in a published workflow reaches the error workflow and shows in admin                                                          | Running stack                             | Pass                       |

Limits on these results:

- **Fresh clone:** the Clerk dashboard steps used an already configured development app, and the n8n owner screen and sign-ins were driven by Chromium, not by a person.
- **Schedules:** the 09:00 and hourly reminder schedules were not observed firing on their own. Reminder runs were triggered directly. The 10:30 health check did fire on the real clock, recording `reminder-run-missing` on a stack with no scheduled run yet.
- **Not tested:** Linux service networking, Safari, Firefox, a physical iPhone, screen readers and usability testing with real people.
- **Names:** every account shows as `Neighbor`. The optional Clerk name claim in the README has not been tested.

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

`npm test` passed 117 checks in four suites: core rules, automation, demo data and color contrast. CI runs this on every push.

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

## Visual design checks

The visual design changed after the checks above, so the size, overflow and keyboard checks were repeated at 320 px and 1280 px on the public page, catalog, tool detail, listings, requests, incoming and admin screens. Every color pair the design uses is covered by the contrast tests, including text and controls on the navy band.

## Timezone checks

The actual backend ran with `APP_TIMEZONE=America/Sao_Paulo`. Its settings query supplied that timezone to the request form. Requests and transitions completed successfully under it. Automated checks crossed the local midnight boundary and the New York daylight-saving fallback boundary with controlled clocks. Calendar state and public availability updated without a loan write. The clock job runs each minute and only changes the stored day when necessary. The clock also checks reminder health once per business date after 10:30 local time, recording a missing fetch even when no loans are overdue.

## Signed delivery and reminder checks

`npm run verify` runs `scripts/verify.ts` against Next.js, local Convex, development Clerk and the published n8n workflows. It uses separate real backend CLI processes for competing approvals, and separate real n8n CLI executions for simultaneous reminder runs. Internal fixture operations are backend-only and require `DEMO_SEED_ENABLED=true`; refusal while disabled is checked before enabling them temporarily.

| Check                                                                                                                                      | Result |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Two genuinely parallel approvals of overlapping requests produce exactly one approval                                                      | Pass   |
| Request, approval, decline, cancellation and return deliver through the published workflow to the stored recipient                         | Pass   |
| Nine signing and envelope rejection cases in each direction return the expected status without notification writes                         | Pass   |
| Unicode and escaped newlines verify without reserializing the payload; extra outer fields and callback recipient substitution are rejected | Pass   |
| Stopping n8n does not roll back a loan; five attempts become visibly failed; an administrator replays the same event after restart         | Pass   |
| An accepted webhook whose callback cannot authenticate remains pending and later settles once                                              | Pass   |
| The fifth attempt remains pending until its final deadline; a late valid callback settles once and an old error cannot overwrite delivery  | Pass   |
| Dispatch racing the sweep consumes one claim for the same due event                                                                        | Pass   |
| Approval delivered before its request remains alongside that request, ordered by occurrence, without changing the current loan status      | Pass   |
| Only overdue outstanding loans receive daily reminders; two concurrent runs create one row per daily key                                   | Pass   |
| Return committed first skips the reminder; reminder committed first leaves one historical row; stale daily keys are rejected               | Pass   |
| A reminder callback fails three times while other items succeed, records a failure and is filled once by the next run                      | Pass   |
| Empty filtered pages continue to the next candidate, and the 20-page cap records an explicit failure                                       | Pass   |
| Disabling the published reminder workflow with zero overdue loans records a missing-run alert visible in the administrator browser         | Pass   |
| A forced failure in the published notification workflow runs the error workflow and appears in the administrator browser                   | Pass   |
| Proposed files and exported definitions contain no private runtime values or pinned execution data                                         | Pass   |
| The actual stored n8n request payload has exactly the eight allowed business fields                                                        | Pass   |
| Notifications and administrator access at 320 px and 1280 px have no sideways overflow or targets below 44 px                              | Pass   |

The complete running-service command passed all 15 checks with real browser authentication enabled. The machine-readable report was read after completion. The new screen measurements cover both destinations as two ordinary users and an administrator: 12 renders and 40 Tab positions per render. The phone More menu contains Notifications, the bottom bar retains four links, and admin retry is activated with the keyboard. Notifications, automation summary, stacked failure rows and recorded-failure screens were captured for visual inspection. The new views reuse the existing Band, design tokens and table styles; no new colors were added. No unresolved conflict with the documented visual decisions was observed.

The reminder scan is deliberately capped at 20 pages of 50 approved loans. Already-reminded loans still occupy their stable scan pages. More than 1,000 overdue loans is outside the supported demonstration scale: another run restarts the scan and does not promise to reach beyond that cap. The cap must create a recorded failure.

The n8n Webhook node supplies both the parsed string envelope and Raw Body binary data. Signature verification uses the original inner string. The raw bytes enforce the 64 KiB wire limit, including whitespace and envelope overhead. Reducing n8n's global payload ceiling was rejected because that ingress returned 500 instead of the required 413; the receiver now returns 413 itself. No signing protocol was changed.

The application persists notifications only. It does not send email or SMS. Workflow exports contain neither pinned data nor credential values. Notification payloads contain only event identifier, transition type, loan identifier, recipient identifier, tool name, status and start/end dates. Overdue responses contain only the documented reminder fields and pagination metadata. Failure storage uses fixed safe summaries rather than arbitrary workflow error bodies.

## Quality and limitations

The final tree passed type checking, ESLint, formatting, all 117 unit checks, production compilation and workflow structure validation using Node 22.22.0 and npm 10.9.4. Playwright stays because the committed verification and recording scripts use it.

Gitleaks passed over the full Git history. Running-service verification searches proposed source files and workflow exports for the actual private environment values without printing them. Environment files, screenshots and execution reports remain ignored. Dependency audit returned 14 moderate lint-tool advisories and no high findings; no automatic dependency changes were applied.

CI runs dependency installation, type checking, lint, formatting, unit checks and production compilation on Linux with fictional public configuration. Running-service checks ran on macOS arm64 with OrbStack and Chromium.

Duplicate detection covers overlapping borrow requests. Separate identical-looking listings can represent distinct physical items and are not deduplicated; the form prevents in-flight repeat submissions. No general create-listing idempotency guarantee is claimed.

Production hosting is not implemented or claimed. Accessibility measurements and keyboard automation are not a usability study or a complete conformance assessment. A green CI badge alone does not prove browser authentication or running-service behavior.
