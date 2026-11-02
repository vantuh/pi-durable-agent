# UI primitives: replacing hand-written controls with shadcn

A plan, tracked here until it is done. Goal: less hand-written UI code, one implementation per
visual element, and the keyboard, focus, and screen-reader behaviour the shadcn primitives already
have.

Written from an audit at `9c2733f`. Line numbers are hints from that commit; find the place by the
description when they drift. Tick a box when its commit lands.

## Why this is needed

- `web/src/components/ui/button.tsx` has two looks (`primary`, `ghost`), no sizes, no `asChild`.
  So nobody uses it: **102 raw `<button>`** in `web/src` and `extensions/` against 4 imports of
  `Button`. Each one restates its own size, hover, focus ring, and disabled state.
- **102 `title=` attributes** act as tooltips: delayed, not reachable by keyboard, absent on touch.
- Six anchored popups are built three different ways (native `<dialog>`, `role="dialog"`,
  absolute positioning), each with its own dismissal and none with focus return.
- Five progress meters, about fifteen border separators, eight inline error blocks, four empty
  states, and four row families are each written more than once.

## Rules for every step

- **Ported, not pasted.** `shadcn add` output is a starting point. Every primitive is rewritten to
  the theme: colours only as `--role-*` utilities (`bg-raised`, `text-muted`, `border-edge`), never
  the shadcn defaults (`bg-primary`, `text-muted-foreground`). See [theme.md](theme.md).
- **Variants as a plain object**, as `button.tsx` does today. No `class-variance-authority`.
- **One primitive, then its call sites.** A step adds the primitive and migrates every site listed
  under it in the same branch; a primitive with no caller is not done.
- **Behaviour stays.** A migration keeps `aria-label`, `aria-pressed`, `aria-expanded`,
  `aria-busy`, keyboard handlers, and focus rules the old markup had. If a primitive cannot hold a
  behaviour, the site stays custom and moves to [Kept custom](#kept-custom).
- **Commit per step**, `refactor(ui): …` or `feat(ui): …`; a new dependency names its reason in the
  message.
- **Check per step:** `pnpm check` and `pnpm test` pass; the touched screens are opened in the
  browser at desktop and mobile width, with keyboard-only navigation tried once.

## Phase 0: Radix packaging

Today Radix comes as six separate `@radix-ui/react-*` packages. This plan needs at least eight
more (tooltip, popover, alert-dialog, checkbox, toggle-group, progress, separator, label) plus
`Slot` for `asChild`.

- [x] Replace the six `@radix-ui/react-*` packages with the single `radix-ui` package and update
      the imports in `web/src/components/ui/*`. One dependency instead of fifteen; tree-shaken
      per primitive. Commit reason: "one Radix package instead of one per primitive".

## Phase 1: Button and Tooltip

The largest win. Every later phase uses both.

### 1.1 Button

- [x] `button.tsx`: add `size` (`default`, `sm`, `icon`, `icon-sm`), `asChild` (Radix `Slot`),
      and a `danger` variant (Stop, Delete). Keep the default `type="button"`.

### 1.2 Tooltip

- [x] Add `components/ui/tooltip.tsx`, one `TooltipProvider` at the root in `main.tsx`.
- [ ] Optional content `Kbd` slot inside a tooltip, for the shortcut that triggers the action
      (see 3.10).

### 1.3 Migrate raw buttons and `title=` hints

Each line: raw `<button>` → `Button` (variant, size); action hint in `title` → `Tooltip`. A
`title` that only shows text cut off by truncation (a file name, a folder path) stays.

Core:

- [ ] `web/src/composer/composer.tsx` — attach (`697`), model chip (`726`), stop (`753`,
      `danger`), send (`800`, keep the busy label and split layout), send-mode trigger (`818`).
- [ ] `web/src/composer/model-menu-dialog.tsx` — add/remove scoped model (`201`, `217`),
      "Make default" (`241`).
- [ ] `web/src/composer/queued.tsx` — queue text, edit, remove (`87–136`).
- [ ] `web/src/transcript/agent-message.tsx` — open-agent icon link (`37`, `asChild` over the
      link).
- [ ] `web/src/transcript/selection-quote.tsx` — floating quote action (`94`).
- [ ] `web/src/transcript/transcript.tsx` — session sidebar icon (`580`); stats `title` (`216`)
      → Tooltip.
- [ ] `web/src/composer/meta.tsx` — stats `title` (`56`) → Tooltip.
- [ ] `web/src/ui/markdown.tsx` — code-block copy (`83`).
- [ ] `web/src/ui/quote.tsx` — remove (`27`).
- [ ] `web/src/ui/lightbox.tsx` — previous / next (`22–36`); keep `aria-disabled` or move to
      `disabled`.
- [ ] `web/src/ui/attachments.tsx` — preview and remove actions (`64`, `90–99`, `109–117`).
- [ ] `web/src/ui/status-fields.tsx` — field `title` (`40`) → Tooltip.
- [ ] `web/src/shell/sessions.tsx` — header and search icons (`874–897`, `914–924`, `971–1034`,
      `1045–1059`); keep pressed/expanded state and the search transition.
- [ ] `web/src/shell/folder-picker.tsx` — crumb and navigation (`226–256`), Cancel / Open
      (`334–355`).
- [ ] `web/src/shell/home.tsx` — header icon, "New session" (`86–104`).
- [ ] `web/src/shell/pages.tsx` — page toggle, back, close (`34–42`, `106–135`).
- [ ] `web/src/shell/panels.tsx` — panel toggles (`70–87`), close (`313–320`).
- [ ] `web/src/shell/settings-content.tsx` — Rebuild / Restart with spinner (`62–81`,
      `110–121`).
- [ ] `web/src/shell/status-bar.tsx` — settings toggle (`95–105`).
- [ ] `web/src/shell/extensions-dialog.tsx` — open, close, actions (`24–35`, `95–106`,
      `178–193`).
- [ ] `web/src/shell/sessions-status.tsx` — dropdown trigger (`246–264`).
- [ ] `web/src/shell/session-parts.tsx` — mark/note `title` (`39`) → Tooltip.

Extensions:

- [ ] `extensions/browser/panel.tsx` — toolbar (`376–383`, `419–493`, `517–520`).
- [ ] `extensions/context-meter/web.tsx` — trigger (`220–229`).
- [ ] `extensions/dictation/web.tsx` — controls (`198–212`).
- [ ] `extensions/files/panel.tsx` — reload, back, row actions (`106–115`, `153–161`, `203–207`).
- [ ] `extensions/git-history/file-tree.tsx` — rows (`60–84`).
- [ ] `extensions/git-history/preview.tsx` — actions (`194–200`).
- [ ] `extensions/git-history/web.tsx` — `196–201`, `435–450`, `629–650`, `735–740`, `784–790`,
      `1078–1105`, `1198–1205`.
- [ ] `extensions/keep-warm/web.tsx` — `204–211`, `287–301`.
- [ ] `extensions/mcp/web.tsx` — `212–222`.
- [ ] `extensions/notes/todos.tsx` — `319–327`, `367–391`.
- [ ] `extensions/pause/web.tsx` — `63–75`.
- [ ] `extensions/push/web.tsx` — `163–185`.
- [ ] `extensions/tags/details.tsx` — `33–48`, `158–171`, `206–249`.
- [ ] `extensions/tags/web.tsx` — "show every tag" and chips (`117–153`).
- [ ] `extensions/usage-limits/web.tsx` — `195–200`, `257–274`.
- [ ] `extensions/git-worktree/web.tsx` — remove (`116–120`).
- [ ] `extensions/anthropic-subscription/account-details.tsx` — submit (`49–61`).
- [ ] `extensions/hotkeys/web.tsx` — prefix-state `title` (`89`) → Tooltip.

Done when `grep -rF '<button' web/src extensions --include=*.tsx | grep -v components/ui` lists
only the sites in [Kept custom](#kept-custom).

## Phase 2: form controls, display primitives

### 2.1 Input (installed, bypassed)

- [ ] `web/src/shell/sessions.tsx` — search (`984–1002`), rename (`1143–1162`).
- [ ] `extensions/git-worktree/web.tsx` — `232–240` (`Input` already imported).
- [ ] `extensions/notes/todos.tsx` — raw inputs (`Input` already imported).
- [ ] `extensions/browser/panel.tsx` — address field (`455–469`).
- [ ] `extensions/push/web.tsx` — `147–161`.
- [ ] `extensions/bash-timeout/details.tsx` — `117–125`.
- [ ] `extensions/dictation/details.tsx` — `236–244`.
- [ ] `extensions/anthropic-subscription/account-details.tsx` — `60–71`.
- [ ] `extensions/git-history/web.tsx` — commit form (`166–190`).

### 2.2 Textarea (new)

- [ ] Add `components/ui/textarea.tsx`, with auto-size as a prop if two callers need it.
- [ ] `web/src/composer/composer.tsx:571` — keep auto-size, keyboard handling, scroll area.
- [ ] `extensions/notes/panel.tsx:268`.
- [ ] `extensions/notes/todos.tsx:447`.
- [ ] `extensions/git-history/web.tsx:180` — commit message.

### 2.3 Checkbox (new)

- [ ] Add `components/ui/checkbox.tsx`.
- [ ] `web/src/shell/folder-picker.tsx:324` — "Show hidden".
- [ ] `extensions/notes/todos.tsx:359` — keep completion and drag.
- [ ] `extensions/git-worktree/web.tsx:233`.
- [ ] `extensions/anthropic-subscription/account-details.tsx:62`.

### 2.4 Separator (new)

Only where the border is a divider of its own; a border that is part of a panel's frame stays a
border.

- [ ] Add `components/ui/separator.tsx`.
- [ ] `web/src/shell/sessions.tsx` — `<hr>` (`1084`), section borders (`901`, `952`).
- [ ] `web/src/shell/settings-content.tsx` — `28`, `47`.
- [ ] `web/src/shell/extensions-dialog.tsx` — `149`.
- [ ] `web/src/shell/folder-picker.tsx` — `310`.
- [ ] `web/src/shell/panels.tsx` — `311`.
- [ ] `web/src/shell/home.tsx` — `84`.
- [ ] `web/src/transcript/transcript.tsx:250` — 1px `span` rule.
- [ ] `web/src/transcript/activity.tsx:418–426` — vertical timeline rule, if `orientation` fits.
- [ ] `web/src/ui/diff.tsx:177` — split-view divider, if it does not fight the column geometry.
- [ ] `extensions/files/panel.tsx` — `151`, `202`.
- [ ] `extensions/git-history/web.tsx` — `732–750`, `1057`.
- [ ] `extensions/git-history/preview.tsx` — `227–231`.
- [ ] `extensions/keep-warm/web.tsx` — `158–175`.
- [ ] `extensions/notes/panel.tsx` — `239–254`.
- [ ] `extensions/notes/todos.tsx` — `215`.
- [ ] `extensions/git-stats/web.tsx` — `99–101`.

`web/src/ui/markdown.tsx:203` keeps the native `<hr>`: it already has separator semantics.

### 2.5 Badge (installed, reduced to one look)

- [ ] `badge.tsx`: add tones (`muted`, `accent`, `ok`, `warn`, `danger`) on the outline base.
- [ ] `web/src/transcript/activity.tsx:401` — "N failed".
- [ ] `web/src/transcript/transcript.tsx:269–279` — compaction pill; the interactive case becomes
      `Button` around a `Badge`, not a clickable badge.
- [ ] `web/src/shell/pages.tsx:45–50`, `web/src/shell/panels.tsx:80–85` — count over an icon;
      keep the absolute position and empty hiding.
- [ ] `web/src/ui/diff.tsx:274–277` — +/− counts, if a pill reads better than bare numbers.
- [ ] `extensions/git-history/web.tsx:1057–1089` — branch / upstream pills (`Badge` already
      imported).
- [ ] `extensions/git-branch/web.tsx:56` — drop the `BADGE` class override for a tone.
- [ ] `extensions/git-stats/web.tsx:89–101`.
- [ ] `extensions/subagents/web.tsx:112–126`.
- [ ] `extensions/tags/web.tsx:24–41`, `117–136`; `extensions/tags/details.tsx:33–48`,
      `158–171` — tag colour stays a theme role per tag.
- [ ] `extensions/context-meter/web.tsx:98–99` — status dot keeps its text alternative.

### 2.6 Progress (new)

One meter, value plus tone (`warn`, `danger`), `role="progressbar"` and `aria-valuenow`.

- [ ] Add `components/ui/progress.tsx`.
- [ ] `web/src/ui/status-fields.tsx:48–58`.
- [ ] `extensions/context-meter/web.tsx:37–38` (the per-part bar at `56` only if it is one
      value; a segmented bar stays custom).
- [ ] `extensions/subagents/web.tsx:135–140`.
- [ ] `extensions/usage-limits/web.tsx:46–52`.
- [ ] `extensions/browser/panel.tsx:328–330`.

## Phase 3: overlays and structure

### 3.1 Popover (new)

Collision-aware placement, outside-click and Escape, focus return.

- [ ] Add `components/ui/popover.tsx`.
- [ ] `extensions/keep-warm/web.tsx:143–180` — native `<dialog>`.
- [ ] `extensions/mcp/web.tsx:130–150` — native `<dialog>`.
- [ ] `extensions/usage-limits/web.tsx:186–216` — native `<dialog>`.
- [ ] `extensions/git-stats/web.tsx:113–160` — `role="dialog"` panel; its error state → `Alert`.
- [ ] `extensions/context-meter/web.tsx:118–120` — popup.
- [ ] `web/src/shell/sessions.tsx:1130–1182` — rename form.
- [ ] `web/src/composer/composer.tsx:726–739` — model chip, only if the model menu moves from a
      dialog into a popover; otherwise the chip stays a `Button` that opens the dialog.

### 3.2 DropdownMenu (installed, bypassed)

- [ ] `dropdown-menu.tsx`: export `CheckboxItem`, `RadioGroup`/`RadioItem`, `Label`,
      `Separator`, `Shortcut` when a caller needs them.
- [ ] `web/src/composer/composer.tsx:762–830` — send-mode menu as `RadioGroup`; arrow keys and
      typeahead replace the custom focus/blur dismissal.

### 3.3 Command (installed, bypassed)

- [ ] `web/src/composer/composer.tsx:511–545` — slash-command completion. Focus must stay in the
      textarea: drive cmdk's selected value from the textarea's arrow keys instead of moving
      focus. If cmdk cannot do that without a second focus owner, this site moves to Kept custom.

### 3.4 AlertDialog (new)

- [ ] Add `components/ui/alert-dialog.tsx`.
- [ ] `web/src/shell/sessions.tsx:1184–1220` — delete confirmation; keep the pending state.
- [ ] `extensions/git-worktree/web.tsx:116–175` — remove-worktree flow.

### 3.5 Sheet (new)

- [ ] Add `components/ui/sheet.tsx` on top of the dialog primitive.
- [ ] `web/src/shell/settings.tsx:20–60` — direct Radix Dialog → Sheet; keep the explicit
      return-focus target.
- [ ] `extensions/git-history/web.tsx:1210–1283` — sliding panel.
- [ ] Decide after the two above: `web/src/shell/panels.tsx:181–187, 293–321` and
      `web/src/shell/sessions.tsx:840–846` on narrow screens only. Wide screens keep the
      resizable panel.

### 3.6 ToggleGroup (new)

- [ ] Add `components/ui/toggle-group.tsx`.
- [ ] `web/src/shell/appearance-dialog.tsx` — flavour (`65–83`), sidebar width (`110–123`),
      layout (`143–155`); the icon button at `30–43` → `Button`.

### 3.7 Alert (new)

`role="alert"` so the error is announced.

- [ ] Add `components/ui/alert.tsx` with `warn` and `danger` tones.
- [ ] `web/src/transcript/transcript.tsx:236–246` — provider error.
- [ ] `extensions/anthropic-subscription/account-details.tsx:74–82`.
- [ ] `extensions/anthropic-subscription/details.tsx:50`, `113`.
- [ ] `extensions/auto-session-name/details.tsx:62`.
- [ ] `extensions/subagents/profile-models.tsx:79`.
- [ ] `extensions/tags/details.tsx:110`.
- [ ] `extensions/usage-limits/details.tsx:63`.

### 3.8 Empty (new)

- [ ] Add `components/ui/empty.tsx`.
- [ ] `web/src/shell/home.tsx:110–112`.
- [ ] `web/src/shell/sessions.tsx:1064–1071` — no search results.
- [ ] `web/src/shell/sessions-status.tsx:284–286`.
- [ ] `web/src/transcript/transcript.tsx:687–697` — empty session.

### 3.9 Item (new)

One row: media, title, description, actions. Links stay links through `asChild`.

- [ ] Add `components/ui/item.tsx`.
- [ ] Session rows: `web/src/shell/sessions.tsx:1093–1115` (`SessionRow`),
      `web/src/shell/home.tsx:36–52, 119–125`, `web/src/shell/sessions-status.tsx:69–106` (keep
      the two-tap touch submenu).
- [ ] Folder rows: `web/src/shell/folder-picker.tsx:289–303, 364–394` (keep double-click).
- [ ] Queue rows: `web/src/composer/queued.tsx:53–136`.
- [ ] Settings rows: `web/src/shell/settings-content.tsx:133–139`.
- [ ] Extension rows: `extensions/files/panel.tsx:104–115`,
      `extensions/subagents/web.tsx:158–170, 271–287`,
      `extensions/subagents/profile-models.tsx:96–101`, `extensions/git-history/web.tsx:434–450`,
      `extensions/git-history/preview.tsx:222–231`.

### 3.10 Kbd (new)

Nothing renders a keycap today.

- [ ] Add `components/ui/kbd.tsx`.
- [ ] Show the shortcut inside the Tooltip of every action that has one: send (`Enter`), stop
      (`Esc`), and the bindings in `extensions/hotkeys`.

### 3.11 Field and Label (new)

Explicit labels instead of placeholders, `aria-invalid` and error text tied to the control.

- [ ] Add `components/ui/field.tsx` and `components/ui/label.tsx`.
- [ ] `web/src/composer/composer.tsx:571` — accessible name for the composer.
- [ ] `web/src/shell/folder-picker.tsx:321–331` — "Show hidden".
- [ ] `extensions/bash-timeout/details.tsx:117–125`.
- [ ] `extensions/dictation/details.tsx:236–244`.
- [ ] `extensions/push/web.tsx:147–161`.
- [ ] `extensions/git-worktree/web.tsx:228–240`.
- [ ] `extensions/git-history/web.tsx:166–190` — commit form.
- [ ] `extensions/notes/panel.tsx:253–278`.

### 3.12 Breadcrumb (new)

- [ ] Add `components/ui/breadcrumb.tsx`.
- [ ] `web/src/shell/folder-picker.tsx:226–256` — path, current segment as `aria-current`.

### 3.13 Table (new)

- [ ] Add `components/ui/table.tsx`.
- [ ] `web/src/ui/markdown.tsx:204–216` — Markdown tables; keep the overflow wrapper.

### 3.14 Card (only where it fits)

The bordered boxes differ in layout; adopt `Card` only where the frame, header, and body really
match, never to force one look.

- [ ] Candidates to judge one by one: `web/src/transcript/transcript.tsx:352–354` (compaction
      summary), `web/src/transcript/agent-message.tsx:25–56`, `web/src/ui/quote.tsx:17`,
      `extensions/git-history/web.tsx:780–782`, `extensions/git-worktree/web.tsx:153–156`.
      Code block (`markdown.tsx:80`), diff (`diff.tsx:297`), user bubble (`transcript.tsx:389`)
      and attachments stay as they are.

## Repeated elements this plan unifies

| Element                   | Copies today | Becomes                          | Phase |
| ------------------------- | ------------ | -------------------------------- | ----- |
| Icon button + `title`     | 40+          | `Button size="icon"` + `Tooltip` | 1     |
| Hint in `title`           | 102          | `Tooltip` (+ `Kbd`)              | 1     |
| Text button               | 60+          | `Button`                         | 1     |
| Hand-styled text input    | ~10          | `Input` + `Field`                | 2, 3  |
| Textarea                  | 4            | `Textarea`                       | 2     |
| Native checkbox           | 4            | `Checkbox`                       | 2     |
| Border / `<hr>` divider   | ~15          | `Separator`                      | 2     |
| Status / count / tag pill | ~12          | `Badge` with tones               | 2     |
| Thin fill meter           | 5            | `Progress`                       | 2     |
| Anchored popup            | 6+           | `Popover`                        | 3     |
| Destructive confirmation  | 2            | `AlertDialog`                    | 3     |
| Edge panel                | 2–3          | `Sheet`                          | 3     |
| Segmented choice          | 3            | `ToggleGroup`                    | 3     |
| Inline error              | ~8           | `Alert`                          | 3     |
| Empty state               | 4            | `Empty`                          | 3     |
| List row                  | 4 families   | `Item`                           | 3     |

## What the primitives add for the user

What a migrated site gains, so a review can check it was not lost on the way.

1. **Tooltip** — shows at once, on keyboard focus too, in the theme; `title` waits a second and
   never shows on touch.
2. **`Button asChild`** — a link keeps link behaviour (Cmd-click, open in new tab) with button
   looks: session rows, agent link, subagent rows.
3. **AlertDialog** — focus trap, Escape, focus return, and the destructive button not focused
   first; no hand-written focus code.
4. **Popover** — flips at the screen edge (`collisionPadding`), closes on outside click and
   Escape, returns focus; matters most on the phone.
5. **DropdownMenu** — arrow keys, typeahead, menu roles; `RadioItem` shows the chosen send mode.
6. **Command** — listbox roles and active option announced for slash commands.
7. **ToggleGroup** — arrow keys inside the group, one tab stop, group semantics.
8. **Kbd** — shortcuts become visible where the action is.
9. **Progress** — `role="progressbar"` with a value; today the meters are silent.
10. **Field / Label** — real labels, descriptions, and `aria-invalid` instead of placeholders.
11. **Checkbox** — the same focus ring and look in every flavour.
12. **Sheet** — one open/close animation and dismissal for edge panels.
13. **Alert** — `role="alert"`, so a provider error is announced.
14. **Empty** — one structure for "nothing here" with room for an action.
15. **Item** — one row layout, so rows in the sidebar, home, folder picker and panels align.

## Kept custom

Replacing these costs more than it saves. They stay hand-written and need no box.

- **Resize handles** — `web/src/shell/panels.tsx:121–178`, `web/src/shell/sessions.tsx:194–214`,
  `web/src/shell/sidebar-bottom.tsx:127–151`: persisted size, keyboard steps, double-click reset,
  live limits. shadcn `Resizable` would add `react-resizable-panels` and a layout rewrite.
- **Drop overlay** — `web/src/composer/drop-overlay.tsx`: a non-modal drag cue, no primitive fits.
- **Lightbox close target** — `web/src/ui/lightbox.tsx:101–108`: click-on-empty-space close next
  to zoom and pan; the viewer itself already is a `Dialog`.
- **Timeline marks** — `web/src/transcript/activity.tsx:160–178`.
- **Attachment** — `web/src/components/ui/attachment.tsx`: our own primitive, already shared.
- **Collapsible** — `web/src/components/ui/collapsible.tsx`: the measured `data-beyond` content
  stays.
- **Sessions-status submenu** — `web/src/shell/sessions-status.tsx:120–187`: two-tap touch
  activation and inline narrow submenu are deliberate.
- **Theme preview bars** — `web/src/shell/appearance-dialog.tsx:180–184`: an illustration, not a
  meter.
