# Front-end decisions

These are the choices I made for how LendLoop looks and works, and why. Each one has a tag so you can see how much weight it carries:

- **Standard:** an accessibility requirement (WCAG 2.2).
- **Research:** published usability research.
- **My call:** my own judgment. No study told me to do this.

Two honest limits. Baymard studies e-commerce sites, not lending boards, so I'm applying its findings by analogy where the task is similar: forms, lists, filters. And I only used Baymard's public articles, not its paid guideline database. I used Claude to help gather and check the sources, and I own the decisions.

## The principle

A neighbor opens this on a phone with one question: can I borrow this, and when? So I kept one job per screen, words instead of icons, and color only as support. Nothing here is decoration.

## Color

**Tokens and measured contrast** (WCAG formula, checked by a unit test in CI, so a later color change can't quietly break them):

| Token | Value | Used on | Ratio | Needs |
|---|---|---|---|---|
| Text | `#171738` | Page `#F9FBFF` | 16.67 | 4.5 |
| Muted text | `#50526B` | Page `#F9FBFF` | 7.34 | 4.5 |
| Primary button | white | `#3423A6` | 10.84 | 4.5 |
| Primary hover | white | `#2E1760` | 14.92 | 4.5 |
| Link | `#3423A6` | Page `#F9FBFF` | 10.46 | 4.5 |
| Danger button | white | `#B42318` | 6.57 | 4.5 |
| Input border | `#7D7D90` | Page `#F9FBFF` | 3.89 | 3.0 |
| Focus ring | `#3423A6` | Page `#F9FBFF` | 10.46 | 3.0 |
| Band text | `#F9FBFF` | Navy `#171738` | 16.67 | 4.5 |
| Band links, labels, focus ring | `#B5C5FF` | Navy `#171738` | 10.19 | 3.0 to 4.5 |
| Band primary button | `#171738` | `#B5C5FF` | 10.19 | 4.5 |
| Badge, success | `#0B5F5C` | `#CCF5F0` | 6.38 | 4.5 |
| Badge, warning | `#7A4B00` | `#FDF0D5` | 6.56 | 4.5 |
| Badge, danger | `#9B1C10` | `#FBE4E1` | 6.73 | 4.5 |
| Badge, neutral | `#3E4060` | `#E9EBF2` | 8.37 | 4.5 |
| Badge, info | `#3423A6` | `#E6EBFF` | 9.13 | 4.5 |

- **Text contrast is at least 4.5:1, borders and focus at least 3:1.** *Standard:* [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). A light grey input border is the usual failure, so mine is darker than most designs would pick.
- **A status is never color alone.** Every badge has words: "Available today", "Out today", "Overdue", "Pending". *Standard:* [WCAG 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html). A green dot and a red dot would mean nothing to a color-blind neighbor.
- **Only one primary button per view.** *Research:* [Baymard on button design](https://baymard.com/blog/button-design) found that a primary action needs to stand out through unique styling, prominence and consistent placement. Too many competing buttons overwhelm people. It's the only solid indigo on a light page, and the only solid periwinkle on a navy band.
- **Navy, indigo and periwinkle, with serif page headings.** *My call:* my first version in green and off-white worked but looked like a wireframe. I took the look from the company this take-home is for, since a reviewer there should recognize how it feels: dark bands with serif headings, small uppercase labels, pill filters and plain white cards. The colors and layout ideas are the only things I borrowed. No logo, images or text. I'm not claiming these colors perform better.
- **Card borders are a light gray that doesn't reach 3:1.** *Standard:* [WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) only needs 3:1 when the border is required to identify a control. A card's border is just visual grouping. Input borders still meet 3:1.
- **No dark mode.** *My call:* it doubles the contrast checks for a feature nobody asked for. Tokens make it easy to add later.

## Sizes

- **Tappable controls are at least 44 by 44 CSS pixels.** *Standard and research:* the WCAG AA minimum is [24 px](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), and the stricter AAA level is [44 px](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html). [Baymard](https://baymard.com/blog/button-design) reports that small targets cause missed and wrong taps. Its 7 mm minimum is a physical size, so I went with the larger WCAG number. WCAG exempts links inside a sentence, and so do I.
- **Body and form text is 16 px.** *My call, backed by secondary sources:* [iOS Safari zooms the page when a focused field is under 16 px](https://docs.squirrelscan.com/rules/mobile/input-zoom). I couldn't find this in Apple's own docs, so I'm treating it as field experience, and I'll test it on a device. I don't disable page zoom to fix it, because people need zoom.
- **Type scale of 14, 16, 18, 24 and 32 px.** 14 is only for secondary details. *My call.*
- **Long text stops at about 70 characters wide, with 1.5 line height.** *Research:* [Baymard on line length](https://baymard.com/research-articles/line-length-readability) recommends 50 to 75 characters and suggests about `70ch`. This applies to tool descriptions.
- **Spacing steps of 4, 8, 12, 16, 24, 32 and 48 px.** *My call:* a short list stops every screen from inventing its own gaps.
- **System fonts, with a system serif for page headings.** *My call:* nothing to download, and it looks native on every device.

## Layout and distribution

- **Designed from phone width up, and works at 320 px with no sideways scrolling.** *Standard:* [WCAG 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
- **Tool grid: 1 column on phones, 2 from 640 px, 3 from 1024 px, page capped at 1120 px.** *My call:* a card needs enough width for its name and badge without wrapping badly.
- **Card order: small category label, name, availability badge, condition, then owner with the Trusted Lender badge.** *My call:* availability comes right after the name because it's what a borrower needs first.
- **Every page opens with a compact navy band holding its title. The public page's band holds the tagline and sign-in button, and the tool list starts right after it.** *My call:* the list is what proves the app is useful, so it shouldn't sit below a big banner.
- **Admin tables become stacked rows on phones.** *Standard:* [WCAG 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) allows a table to need two-dimensional layout, but its cells still have to reflow, and stacking avoids the problem completely.

## Navigation

- **Desktop: every destination visible across the top. Phone: Tools, Listings, Requests and Incoming always visible, with everything else under "More".** *Research:* [NN/g's study of 179 people](https://www.nngroup.com/articles/hamburger-menus/) found hidden navigation was used less and took longer. Its advice for phones is to show up to four top-level links and hide the rest. Those four are the core borrowing tasks.
- **Phone navigation sits at the bottom of the screen.** *My call:* it's easier to reach one-handed. I found no study I'd cite for this.

## Forms

- **One column.** *Research:* [Baymard](https://baymard.com/research-articles/avoid-multi-column-forms) found multi-column forms led to skipped fields and more errors. Its one exception is a set of fields that form a single unit, which is why start and end date share a row on wider screens.
- **Labels sit above fields, and they stay there.** *Research:* [Baymard](https://baymard.com/blog/input-fields) says labels work best above fields on mobile, and [NN/g](https://www.nngroup.com/articles/form-design-placeholders/) found placeholder-only labels make people forget what a field is for.
- **Native date inputs, with busy dates listed right above them.** *Research plus a tradeoff:* [NN/g](https://www.nngroup.com/articles/date-input/) says calendars suit near-term dates and ranges, and typing should stay possible. It also says to prevent illogical dates, so I set the minimum to today. The ideal is graying out booked days, but native inputs can't do that. So I show the busy ranges, and check for a conflict as soon as both dates are filled in. Baymard's [tour-booking research](https://baymard.com/blog/tours-and-experiences-launch) found that calendars which don't show availability make people spend extra time verifying it. A custom calendar would solve this properly, but it's a lot of accessibility work for a take-home.
- **Errors appear next to the field, in plain words, after you leave a field you filled in or when you submit, and what you typed stays. Leaving an empty field alone is not an error.** *Research:* [Baymard](https://baymard.com/blog/checkout-flow-ux-optimization) on flagging errors after a field is finished, keeping what was entered and moving people to the error, [NN/g](https://www.nngroup.com/articles/error-message-guidelines/) on proximity, wording and not blaming the user. So "End date must be on or after the start date", not "Invalid date".
- **Screen readers hear save and error messages without losing their place.** *Standard:* [WCAG 4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html), using `role="status"` and `role="alert"`.
- **The submit button is never grayed out to signal an incomplete form. It only shows "Saving..." while a request is in flight.** *Research:* [GOV.UK Design System](https://design-system.service.gov.uk/components/button/) advises avoiding disabled buttons because of poor contrast and confusion. It also says double-click protection must exist on the server too. Mine does for loans: the backend rejects overlapping duplicate requests, and repeating a completed action does nothing. A listing form only blocks repeat clicks while saving, because two identical listings can be two real tools.

## Filtering

- **Category chips above the list, always visible, with an "All" option.** *Research:* [Baymard](https://baymard.com/blog/how-to-design-applied-filters) says active filters must stay visible above the results on desktop and mobile, otherwise people forget them and think the catalog is empty. There are only five categories, so I don't need the filter overlay and apply button Baymard suggests for larger filter sets.
- **The filter lives in the URL.** *Research:* [Baymard](https://baymard.com/blog/ecommerce-filter-ui) recommends this so it survives the Back button.
- **One category at a time.** *My call:* Baymard's advice is multi-select for filters in general, but with five categories, single choice is simpler and I'd revisit it with more data.

## States and feedback

- **Loading is never shown as "nothing here".** *Research:* [NN/g on empty states](https://www.nngroup.com/articles/empty-state-interface-design/) warns that people may conclude nothing exists and stop waiting.
- **Every empty list says what's missing and offers the next step,** such as "You haven't listed anything yet" with a button to list a tool. Same source.
- **A filter with no results offers a way back to all categories.** *Research:* [Baymard](https://baymard.com/blog/ecommerce-filter-ui) on zero-result recovery.
- **Show progress when something takes over a second.** *Research:* [NN/g's response time limits](https://www.nngroup.com/articles/response-times-3-important-limits/).
- **Confirmation dialogs only where there's no undo: delete a listing, admin removal, cancel an approved loan, confirm a return. Approve and decline don't get one.** *Research:* [NN/g](https://www.nngroup.com/articles/confirmation-dialog/) warns that frequent dialogs get clicked through. It also says to name the outcome on the buttons ("Delete listing", "Keep listing") and not to set a default answer.
- **No animation and no decorative icons or emoji.** *My call:* they'd add nothing to these tasks.

## What I'd test with real people

I haven't run a usability test on this. The research reduces risk, but it doesn't replace watching a neighbor try it. First I'd check whether people understand that "Available today" says nothing about next week, whether the busy-dates list works without a real calendar, and whether lenders remember to confirm returns.
