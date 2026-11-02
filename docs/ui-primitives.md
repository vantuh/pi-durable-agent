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
- **State on a shared trigger is `aria-expanded`.** Under `Hint`, a menu, dialog, or collapsible
  trigger's `data-state` belongs to the tooltip; style or read the open state through
  `aria-expanded` instead.
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
- [x] `Hint`: one-line wrapper (trigger as child + content), so call sites stay one element.
- [ ] Optional content `Kbd` slot inside a tooltip, for the shortcut that triggers the action
      (see 3.10).

### 1.3 Migrate raw buttons and `title=` hints

Each line: raw `<button>` → `Button` (variant, size); action hint in `title` → `Tooltip`. A
`title` that only shows text cut off by truncation (a file name, a folder path) stays.

Core:

- [x] `web/src/composer/composer.tsx` — attach (`697`), model chip (`726`), stop (`753`,
      soft danger on `ghost`, not the solid `danger`), send (`800`, keep the busy label and split layout), send-mode trigger (`818`).
- [x] `web/src/composer/model-menu-dialog.tsx` — add/remove scoped model (`201`, `217`),
      "Make default" (`241`).
- [x] `web/src/composer/queued.tsx` — edit, remove, and the text disclosure (`87–136`). The
      disclosure is ghost with `p-0`, no hover fill, and `block` / `line-clamp-2` for its two states;
      `line-clamp-2` and `block` both drop ghost's `inline-flex`, so the clamp still holds.
- [x] `web/src/transcript/agent-message.tsx` — open-agent icon link (`37`, `asChild` over the
      link).
- [x] `web/src/transcript/selection-quote.tsx` — floating quote action (`94`).
- [x] `web/src/transcript/transcript.tsx` — session sidebar icon (`580`); stats `title` (`216`)
      → Tooltip.
- [x] `web/src/composer/meta.tsx` — stats `title` (`56`) → Tooltip.
- [x] `web/src/ui/markdown.tsx` — code-block copy (`83`).
- [x] `web/src/ui/quote.tsx` — remove (`27`).
- [x] `web/src/ui/lightbox.tsx` — previous / next (`22–36`); keep `aria-disabled` or move to
      `disabled`. Kept `aria-disabled`: a `disabled` trigger is not focusable, so its Hint would
      never show.
- [x] `web/src/ui/attachments.tsx` — preview and remove actions (`64`, `90–99`, `109–117`).
      Only their `title` hints move: the trigger and the action button belong to the Attachment
      primitive; see [Kept custom](#kept-custom).
- [x] `web/src/ui/status-fields.tsx` — field `title` (`40`) → Tooltip. Hover-only: the field is a
      readout, and a tab stop would put every field of the status bar in the tab order.
- [x] `web/src/shell/sessions.tsx` — header and search icons (`874–897`, `914–924`, `971–1034`,
      `1045–1059`); keep pressed/expanded state and the search transition. The home link and the
      two panels' own buttons (`type="submit"` kept) went with them; the row's actions trigger
      stays for [Item](#39-item-new), and the rename and delete frames for [Popover](#31-popover-new)
      and [AlertDialog](#34-alertdialog-new).
- [x] `web/src/shell/folder-picker.tsx` — crumb and navigation (`226–256`), Cancel / Open
      (`334–355`). The crumbs stay raw: they are text on a path, and
      [Breadcrumb](#312-breadcrumb-new) replaces them with links and `aria-current`.
- [x] `web/src/shell/home.tsx` — header icon, "New session" (`86–104`).
- [x] `web/src/shell/pages.tsx` — page toggle, back, close (`34–42`, `106–135`).
- [x] `web/src/shell/panels.tsx` — panel toggles (`70–87`), close (`313–320`). The close button
      gains the `aria-label` it never had.
- [x] `web/src/shell/settings-content.tsx` — Rebuild / Restart with spinner (`62–81`,
      `110–121`). Rebuild keeps `aria-busy` and moves `disabled` to `aria-disabled`: its title said
      what the disabled state was doing, and a disabled trigger would never show that hint.
- [x] `web/src/shell/status-bar.tsx` — settings toggle (`95–105`).
- [x] `web/src/shell/extensions-dialog.tsx` — open, close, actions (`24–35`, `95–106`,
      `178–193`).
- [x] `web/src/shell/sessions-status.tsx` — dropdown trigger (`246–264`). `Hint` wraps the
      `DropdownMenuTrigger`, so Radix still owns the trigger's `aria-expanded` and its menu.
- [x] `web/src/shell/session-parts.tsx` — mark/note `title` (`39`) → Tooltip. Hover-only: the
      mark is a readout, and a tab stop before every row's title would be noise.

Extensions:

- [x] `extensions/browser/panel.tsx` — toolbar (`376–383`, `419–493`, `517–520`). `IconButton` keeps its
      `disabled:opacity-40` and `disabled:hover:bg-transparent`; a disabled hint waits for the
      button to work again, since its title only named the action. The address field stays for
      [Input](#21-input-installed-bypassed) and the error count for [Progress](#26-progress-new);
      the presets read "Mobile", "Tablet", and "Desktop" instead of the lowercase operation names.
- [x] `extensions/context-meter/web.tsx` — trigger (`220–229`). `font-normal` and `text-faint` keep the
      readout as light as it was, and `hover:bg-sunken` as quiet; the popup stays for
      [Popover](#31-popover-new) and the bars for [Progress](#26-progress-new).
- [x] `extensions/dictation/web.tsx` — controls (`198–212`). Each state names its own hover: ghost's
      `hover:text-ink` would repaint the red recording state and the yellow wait. The pointer-down
      guard that keeps focus in the textarea stays on the button.
- [x] `extensions/files/panel.tsx` — reload, back (`153–161`, `203–207`). The row itself (`106–115`)
      waits for [Item](#39-item-new): it is one button that the whole row is, indented by padding.
- [x] `extensions/git-history/file-tree.tsx` — rows (`60–84`). They stay raw: the row is the
      indent, and [Item](#39-item-new) owns the family.
- [x] `extensions/git-history/preview.tsx` — actions (`194–200`). The header keeps `h-9`, `bg-panel`,
      its top border, and its square corners: it is measured as 36px by the diff view.
      Its `WithoutDiff` rows stay for [Item](#39-item-new).
- [x] `extensions/git-history/web.tsx` — `196–201`, `435–450`, `629–650`, `735–740`, `784–790`,
      `1078–1105`, `1198–1205`. `font-normal` and `text-ink` keep the page's actions as light as
      they were, and the shared `button` string keeps the border, the 40% disabled look, and the
      not-allowed cursor ghost has no tone for. The commit row keeps its square corners and its
      inset ring; `Item` still owns the row's content. Refresh keeps `disabled`, so its hint waits
      for the read to end. Pills, fields, the sliding panel, and the separators stay as they are.
- [x] `extensions/keep-warm/web.tsx` — `204–211`, `287–301`. The trigger keeps `font-normal` and its
      own `hover:bg-sunken`, so ghost's raised hover fill does not stand in for it; the flame and the
      cold grey keep their two states. The row's × is a 24px target now, taller than the 12px text
      beside it. The popup stays for [Popover](#31-popover-new) and its rules for
      [Separator](#24-separator-new).
- [x] `extensions/mcp/web.tsx` — `212–222`. The count keeps `text-muted`: under ghost it would inherit the
      trigger's ink on hover and brighten beside a label that was already ink. The `<dialog>`
      popup stays for [Popover](#31-popover-new).
- [x] `extensions/notes/todos.tsx` — `319–327`, `367–391`. The title keeps `px-0 py-0`, `justify-start`,
      `text-interface`, and `font-normal`: ghost would centre it and pad the row. The grip and the
      delete are 24px targets, and both gain ghost's raised hover; their `mt` offsets went, because
      the offsets that centred a 16px icon only push a 24px box off its line. The drag attributes and
      listeners stay on the element. Raw inputs, the checkbox, and the textarea stay for
      [Input](#21-input-installed-bypassed), [Checkbox](#23-checkbox-new), and
      [Textarea](#22-textarea-new).
- [x] `extensions/pause/web.tsx` — `63–75`. The paused step keeps its yellow fill and its own hover,
      because ghost's ink and raised fill would paint over it. The button gains the `aria-label` its
      `title` was standing in for.
- [x] `extensions/push/web.tsx` — `163–185`. The button is ghost, keeping its raised fill, its
      ink, its `hover:bg-edge-soft`, and `gap-2`; the label is regular like every ghost button. The
      contact field stays for [Input](#21-input-installed-bypassed).
- [x] `extensions/tags/details.tsx` — `33–48`, `158–171`, `206–249`. Cancel keeps `px-1 py-0`, so it stays
      the height of the Save beside it; the pencil and the bin are 24px targets inside a 24px row, and
      their hints wait while a change is in flight. The colour dots stay raw; see
      [Kept custom](#kept-custom).
- [x] `extensions/tags/web.tsx` — "show every tag" and chips (`117–153`). `clear` is a `Button` and a
      `Hint`, keeping `px-1 py-0` so the filter row does not grow, and gaining ghost's raised fill on
      hover. The chips keep their own markup: a
      wash of the tag's hue is the pill, and ghost's `hover:bg-raised` would replace it on hover,
      which is the one thing a tag chip may not lose. Their action title is a `Hint` now, and the
      look is [Badge](#25-badge-installed-reduced-to-one-look)'s to own.
- [x] `extensions/usage-limits/web.tsx` — `195–200`, `257–274`. The trigger keeps `text-faint`,
      `font-normal`, and its own `hover:bg-sunken`. The refresh is a 24px target, the height of the
      heading beside it. The `<dialog>` stays for [Popover](#31-popover-new) and the meter for
      [Progress](#26-progress-new).
- [x] `extensions/git-worktree/web.tsx` — remove (`116–120`). The × is ghost in the icon's own 14px
      box with the hover fill off, so nothing paints outside the 16px pill; its action title is a
      `Hint` now. The dialog's `Remove worktree` is `variant="danger"` instead of a hand-painted one,
      and the flow itself waits for [AlertDialog](#34-alertdialog-new).
- [x] `extensions/anthropic-subscription/account-details.tsx` — submit (`49–61`). The button is ghost
      inside its own border, with `text-ink` and `font-normal` so it reads as the outline action it
      was; it is a `type="button"` that reads and does not submit, and the field beside it stays for
      [Input](#21-input-installed-bypassed).
- [x] `extensions/hotkeys/web.tsx` — prefix-state `title` (`89`) → Tooltip. Hover-only: the armed
      prefix is a readout in the status bar, and a tab stop for it would put the reminder in the tab
      order of every page.

Done when `grep -rF '<button' web/src extensions --include=*.tsx | grep -v components/ui` lists
only the sites in [Kept custom](#kept-custom) and the ones a later step owns. After the Phase 1
review it lists 19: five kept custom (the lightbox close, the two resize handles, the two tag colour
dots), and fourteen another step rewrites — [Item](#39-item-new) rows and the folder picker (5, the
two file-tree rows among them), [ToggleGroup](#36-togglegroup-new) in the appearance dialog (3), the
git-stats panel (2, [Popover](#31-popover-new) and [AlertDialog](#34-alertdialog-new)), and one each
for the [Badge](#25-badge-installed-reduced-to-one-look) chip, the
[DropdownMenu](#32-dropdownmenu-installed-bypassed) send modes, the
[Command](#33-command-installed-bypassed) slash list, and the [Breadcrumb](#312-breadcrumb-new)
crumbs. The third resize handle is a `div role="separator"`, not a button.

One action hint is still `title=`: git-stats' Push, whose title also says why it is disabled
([Popover](#31-popover-new), [AlertDialog](#34-alertdialog-new)). The rest of the `title=` left in the
app is a readout, not an action, and stays — listed under [Kept custom](#kept-custom).

### 1.4 The Phase 1 review

What the review of the migration found and fixed.

- [x] Left-aligned labels: ghost's `inline-flex` centring had replaced the `text-left` the raw
      buttons had on the diff file header, the history row metadata, and a to-do title.
- [x] Weight: the base says `font-normal`, and `primary` / `danger` add `font-medium`. The four ghost
      callers that were medium before the change say `font-medium` themselves; every other ghost
      button's `font-normal` went, since ghost now carries it.
- [x] `extensions/push/web.tsx` — the device switch is `variant="ghost"` instead of a hand-painted
      primary.
- [x] Classes a variant or a size already set: gap, colour, font size, and hover fill dropped where
      ghost or the default size supplies the same.
- [x] `web/src/shell/appearance-dialog.tsx` — the palette gear (`30–43`) is a ghost `Button` and a
      `Hint`; the three choice groups stay for [ToggleGroup](#36-togglegroup-new).
- [x] `web/src/shell/sessions.tsx` — a row's actions trigger (`310`) is ghost `size="icon"` with the
      panel fill as its hover, a `Hint`, and its `aria-label` kept. The rows stay for
      [Item](#39-item-new).
- [x] `web/src/shell/folder-picker.tsx` — the favourite star (`389`) is ghost in its own 16px box,
      with the hint the `title` gave. Rows and crumbs stay for [Item](#39-item-new) and
      [Breadcrumb](#312-breadcrumb-new).
- [x] `extensions/git-stats/web.tsx` — the push panel's close (`145`) is a `Button` in its 16px box.
      The trigger and the confirm stay for [Popover](#31-popover-new) and
      [AlertDialog](#34-alertdialog-new).
- [x] `web/src/components/ui/dialog.tsx` and `web/src/shell/settings.tsx` — the dialog and the sheet
      close are ghost `Button`s with a `Hint`; the sheet keeps its explicit return-focus target.
- [x] `web/src/styles/styles.css` — a row's actions are shown by `[aria-expanded="true"]`, not
      `[data-state="open"]`: the `Hint` around the trigger puts the tooltip's own `data-state` on
      that element, and the menu's is lost.

## Phase 2: form controls, display primitives

### 2.1 Input (installed, bypassed)

The nine sites below are migrated. One look changed on all of them: a hand-written `py-1.5` box was
36.5px tall, and the primitive is `h-8` (32px), the height the to-do and worktree fields already
had. No `size` prop was added for the 4px: the field height is the primitive's, one height for every
field in the app.

- [x] `web/src/shell/sessions.tsx` — search (`984–1002`), rename (`1143–1162`). The search keeps `h-full`
      and its `pl-7 pr-7`, the room the icon and the × need, and the rename field keeps `bg-canvas` so
      it stays lighter than the card it sits in; both keep `text-sidebar` and `border-edge-soft`.
      The accent focus is Input's ring now, not a border colour: one focus treatment for one field.
- [x] `extensions/git-worktree/web.tsx` — `232–240` (`Input` already imported). The name field was
      `Input` before this step, so only the checkbox beside it is left, for [Checkbox](#23-checkbox-new).
- [x] `extensions/notes/todos.tsx` — raw inputs (`Input` already imported). Both fields, the add
      form and an item's title, were `Input` before this step; the checkbox and the textarea beside
      them stay for [Checkbox](#23-checkbox-new) and [Textarea](#22-textarea-new).
- [x] `extensions/browser/panel.tsx` — address field (`455–469`). It stays monospace and borderless:
      `border-transparent`, so a background with no frame is still the look, and `px-2.5` keeps the
      text off the edge. Its `title` is the page's size and name, a readout, so it stays a `title`.
- [x] `extensions/push/web.tsx` — `147–161`. The field's classes were `Input`'s own, so only the
      label around it changed: `htmlFor` and an `id` on the field, because the a11y rule follows an
      `input` element and cannot see one inside `Input`. The label's own look waits for
      [Field](#311-field-and-label-new).
- [x] `extensions/bash-timeout/details.tsx` — `117–125`. The `FIELD` string it shared with Dictation
      was `Input`'s own classes, so it went; the label takes `htmlFor` and the field an `id` for the
      a11y rule above. `type="number"`, the Enter commit, and the blur commit stay on the field.
- [x] `extensions/dictation/details.tsx` — `236–244`. The `FIELD` string stays for the two pickers'
      triggers, which are `DropdownMenuTrigger`s and not fields; the idle field takes `htmlFor`/`id`
      like the one above, and stands one step shorter than the picker over it until that trigger is
      a field too.
- [x] `extensions/anthropic-subscription/account-details.tsx` — `60–71`. Nothing to migrate: the
      control at that line is the "Include email and organization" checkbox, which is
      [Checkbox](#23-checkbox-new)'s; the section has no text field.
- [x] `extensions/git-history/web.tsx` — commit form (`166–190`). The title is `Input` and takes
      `htmlFor`/`id`; `fieldClass` stays for the description textarea, which is
      [Textarea](#22-textarea-new)'s. Autofocus and the Enter submit are unchanged.

### 2.2 Textarea (new)

- [x] Add `components/ui/textarea.tsx`, with auto-size as a prop if two callers need it. No prop: only
      the composer grows with its text, and it does that itself with `field-sizing: content`. The
      primitive is `Input`'s look without a height, so it is as tall as its `rows` say.
- [x] `web/src/composer/composer.tsx:571` — keep auto-size, keyboard handling, scroll area. It stays
      hand-written: the card around it is the frame, so `Textarea` would arrive as a reset list and
      give back only classes the field already has. The reason is under [Kept custom](#kept-custom).
- [x] `extensions/notes/panel.tsx:268`. The editor fills the panel, so it takes the frame off
      (`border-transparent bg-transparent`) and keeps its own `px-3 py-2`, `min-h-0 flex-1`, and
      `resize-none`, as the browser's address field does. It drops the ring too
      (`focus-visible:ring-0`): the panel clips it to a line at the top and bottom, and the caret
      already shows the focus.
- [x] `extensions/notes/todos.tsx:447`. The description keeps `rows={4}` and `resize-y`, the one
      class it had over `Input`'s own; its height, padding, and colours are what they were.
- [x] `extensions/git-history/web.tsx:180` — commit message. The description takes `htmlFor`/`id`
      like the title, and drops the `fieldClass` that was left for it: `Input`'s padding step is the
      textarea's now, so the 4px between the two fields of the form is gone.

### 2.3 Checkbox (new)

- [x] Add `components/ui/checkbox.tsx`. Radix's root is a `button role="checkbox"`, so no call site keeps
      `checked`/`onChange`: they take `checked`/`onCheckedChange`, and a `<label>` around one gets
      `htmlFor` and an `id` beside its text, since the a11y rule only follows an `input`. Chromium still
      forwards the label's click to the button, so clicking the text keeps toggling. The radius is
      `rounded-control` like every other control: at 16px it reads rounder than the browser's own box.
- [x] `web/src/shell/folder-picker.tsx:324` — "Show hidden". The dialog's own state, never saved.
- [x] `extensions/notes/todos.tsx:359` — keep completion and drag. The box keeps `mt-0.75` and shows
      its `aria-label` instead of a label; the drag attributes stay on the grip beside it.
- [x] `extensions/git-worktree/web.tsx:233`. The tick still puts the caret in the name field beside it, and
      the label's own look waits for [Field](#311-field-and-label-new).
- [x] `extensions/anthropic-subscription/account-details.tsx:62`. The `disabled` while a check runs is the
      primitive's 50%, as on `Input`; the label's own look waits for
      [Field](#311-field-and-label-new).

### 2.4 Separator (new)

Only where the border is a divider of its own; a border that is part of a panel's frame stays a
border.

- [x] Add `components/ui/separator.tsx`. Radix hands `decorative` through as given rather than
      defaulting it, so the primitive states `true` itself; the line is `edge-soft`, the colour of the
      borders it replaces, `h-px w-full` across its parent or `w-px self-stretch` down it.
- [x] `web/src/shell/sessions.tsx` — `<hr>` (`1084`), section borders (`901`, `952`). The `<hr>` is a
      `Separator decorative={false}`, and it keeps its `mx-2` beside `w-auto`: a box with side margins
      cannot be `w-full`. The two section borders stay: each is the bottom edge of a toolbar block — the
      folder bar, whose border the rail's `FOLD` transitions away, and the filter strip that closes the
      same region right under it.
- [x] `web/src/shell/settings-content.tsx` — `28`, `47`. The `divide-y` between the sections is a
      `Separator` before each section an extension adds. The footer's top border stays: it is the edge
      of the sheet's footer, not a line between two sections.
- [x] `web/src/shell/extensions-dialog.tsx` — `149`. The rule above an extension's details is a
      `Separator` in the column's `gap-3`, and the block below it drops `pt-3`: the gap below the line
      and that padding were both 12px, so one of them is enough.
- [x] `web/src/shell/folder-picker.tsx` — `310`. Stays: the footer's top edge.
- [x] `web/src/shell/panels.tsx` — `311`. Stays: the panel header's bottom edge.
- [x] `web/src/shell/home.tsx` — `84`. Stays: the home card's header bottom edge.
- [x] `web/src/transcript/transcript.tsx:250` — 1px `span` rule. It is `Separator asChild` over the
      span, because half of its eight hosts are `CollapsibleTrigger`s, which are buttons, and a
      button takes phrasing content only.
- [x] `web/src/transcript/activity.tsx:418–426` — vertical timeline rule. `orientation="vertical"` fits
      the absolute placement without a wrapper: its base is `w-px self-stretch`, a height that does not
      fight `top-5 bottom-5`, and its colour was `edge`, not `edge-soft`.
- [x] `web/src/ui/diff.tsx:177` — split-view divider. Stays: it is the right column's own left edge,
      the two columns are `flex-1` siblings that scroll inside their own boxes, and a line between them
      would be a third element with the geometry of neither.
- [x] `extensions/files/panel.tsx` — `151`, `202`. Stay: the bottom edge of each view's toolbar — the
      tree's label row and the viewer's back row.
- [x] `extensions/git-history/web.tsx` — `732–750`, `1057`. Stay: the bottom edge of the review header
      and of the toolbar, and the issue banner's own bottom edge.
- [x] `extensions/git-history/preview.tsx` — `227–231`. Stays: each row's own top edge, and the row
      family is [Item](#39-item-new)'s.
- [x] `extensions/keep-warm/web.tsx` — `158–175`. Both rules of the popup are `Separator`s carrying the
      `mt-2` the border had, and the blocks under them keep their `pt-2`.
- [x] `extensions/notes/panel.tsx` — `239–254`. Stay: the bottom edge of the tabs header, and of the
      conflict banner under it.
- [x] `extensions/notes/todos.tsx` — `215`. Stays: the tabs header's bottom edge.
- [x] `extensions/git-stats/web.tsx` — `99–101`. Stays: a divider inside the pill, as tall as the text
      beside it (measured 18px in the pill's 28), which a stretched separator would run taller;
      [Badge](#25-badge-installed-reduced-to-one-look) takes the pill whole.

`web/src/ui/markdown.tsx:203` keeps the native `<hr>`: it already has separator semantics.

### 2.5 Badge (installed, reduced to one look)

- [x] `badge.tsx`: tones (`muted`, `raised`, `accent`, `info`, `warn`, `danger`) as one colour set each on
      the outline base, plus `asChild` (`Slot`) for a chip that is a link or a button. `muted` is the
      default, so a caller that says nothing renders what it rendered before. No `ok`: nothing in the
      app wears a green pill (the green marks are the timeline's circles).
- [x] `web/src/transcript/activity.tsx:401` — "N failed". The pill takes the badge's own metrics: 18.5px
      tall and 51.6px wide in 11px sans medium became 20px and 75.6px in the badge's 12px mono, and it
      gains the tone's 40% border. The count now reads with the duration beside it.
- [x] `web/src/transcript/transcript.tsx:269–279` — compaction pill; the interactive case becomes
      `Button` around a `Badge`, not a clickable badge. No `Button` was needed: the pill was never the
      click target, the `CollapsibleTrigger` around it and its two rules is, and it is already a real
      button; the badge inside is inert content. `PILL_TONES` and `CompactionPill` went. The pill is
      20px tall instead of 28 and 243.1px wide instead of 261.1: the badge's `px-2` and `gap-1`
      instead of `px-3` and `gap-2`, and its 12px icon instead of 14. It keeps `font-sans`: unlike
      every other badge it holds a sentence, not a value. The warn and danger pills lose a wash step
      (`/30` border, `/10` fill) for the tone's `/40` and `/15`.
- [x] `web/src/shell/pages.tsx:45–50`, `web/src/shell/panels.tsx:80–85` — count over an icon;
      keep the absolute position and empty hiding. The 14px box, its `-top-1 -right-1` corner and
      `empty:hidden` are the badge's, passed through: the height is still 14px, and a digit is 1.7px
      wider (17.2 against 15.5) because the badge's border is 1px and its digit is mono. The
      extension's own component was called `Badge` in both files and is `Count` now, so the import
      does not shadow it.
- [x] `web/src/ui/diff.tsx:274–277` — +/− counts stay bare numbers: both hosts put them in a row of
      mono metadata (a diff header at 12px, a step row at 11px) beside a path that truncates, where a
      frame around two already-coloured numbers would only take room from the name.
- [x] `extensions/git-history/web.tsx:1057–1089` — branch / upstream pills (`Badge` already
      imported). The branch pill was a badge already and keeps its `h-4 px-1.5` and its 10px icon.
      The upstream readout was bare text; it is a badge at the branch pill's 16px now, 64.4px wide
      with its frame and its `title`, and the two read as one row of git facts.
- [x] `extensions/git-branch/web.tsx:56` — drop the `BADGE` class override for a tone. Nothing to
      drop: `BADGE` holds only geometry (`hidden` until `sm`, `h-4`, `max-w-full min-w-0 shrink`,
      `px-1.5`, a 10px icon) and never named a colour, so the default `muted` tone is already what the
      pill wears. It keeps its `title`.
- [x] `extensions/git-stats/web.tsx:89–101`. The pill is the badge whole: 28px tall, `px-2`, `gap-2`,
      mono 12px, the muted tone's `border-edge` and `text-muted`, and `bg-panel` passed through, so
      nothing moved. Two things are passed through as well: `[&>svg]:size-3.5` keeps the compare
      icon at its 14px (the badge's own is 12, and the two arrows inside the divider are not direct
      children, so they stay 12), and the divider stays the inner `border-l`, as tall as the text
      beside it. The Push trigger inside stays for [Popover](#31-popover-new).
- [x] `extensions/subagents/web.tsx:112–126`. What the chip holds is a state dot, a name, a model, and
      a 10px path annotation; none of it is a pill, and the status a row shows
      (`AgentRow`, `:297`) is bare text beside its dot. The badge takes the chip's frame; the path
      annotation stays as it is, 10px text inside a 36px row that [Item](#39-item-new) owns.
- [x] The agent chip that is a link (`extensions/subagents/web.tsx:102`) takes `asChild` over its
      `a`, so the link keeps Cmd-click while the badge gives the look. It keeps its `href`, its
      `isPlainClick` guard, its `aria-label` and its `title`; 36px tall, 6px radius, the panel fill
      and the sans font are passed through, so the chip measures 249.2×36 as before. `web/src/lib/utils.ts`
      had to learn the theme's two radius names: `rounded-control` was unknown to tailwind-merge and
      lost to the badge's base `rounded-full`, which made the chip a pill.
- [x] `extensions/tags/web.tsx:24–41`, `117–136`; `extensions/tags/details.tsx:33–48`,
      `158–171` — tag colour stays a theme role per tag. Both chips are badges with the tag's
      `TAG_TONE` passed through and `border-0 h-auto rounded-control px-1 py-0.5 font-sans` beside
      it: 22px tall, 6px radius, no frame, sans, measured 66.9px and 70.9px wide as before. The
      filter chip is `Badge asChild` over its `button`, so `aria-pressed` and its own
      `hover:brightness-110` stay and the wash keeps its hue on hover; its × is 10px by
      `[&>svg]:size-2.5`. It gains the accent focus ring every other control has, in place of the
      browser's own outline. The colour dots in `details.tsx` stay: see [Kept custom](#kept-custom).
- [x] `extensions/context-meter/web.tsx:98–99` — status dot keeps its text alternative. It is a 10px
      accent square that marks a group's colour in the heading beside it, not a pill: a badge would
      come with a 20px box, a 12px mono label and 8px of padding around a mark that has no text of
      its own. The heading is the text alternative, so nothing is lost.
- [x] `extensions/git-worktree/web.tsx:95`, `:107` — the two badges that hold the × migrated in Phase 1,
      named by the [Kept custom](#kept-custom) inventory and not by a line of their own. `WORKTREE`
      keeps only what the badge does not set (`h-4 max-w-full min-w-0 shrink px-1.5`, a 10px icon), and
      the gone one is the `danger` tone: 16px as before, its solid red border now 40% with the tone's
      15% wash behind it, so a session whose folder is gone reads as the failed pill does. No session
      on this machine works in a worktree, so this pair was measured in the page rather than in a live
      badge.

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
      return-focus target. The header's close is a `Button` already.
- [ ] `extensions/git-history/web.tsx:1210–1283` — sliding panel.
- [ ] Decide after the two above: `web/src/shell/panels.tsx:181–187, 293–321` and
      `web/src/shell/sessions.tsx:840–846` on narrow screens only. Wide screens keep the
      resizable panel.

### 3.6 ToggleGroup (new)

- [ ] Add `components/ui/toggle-group.tsx`.
- [ ] `web/src/shell/appearance-dialog.tsx` — flavour (`65–83`), sidebar width (`110–123`),
      layout (`143–155`). The palette gear above them is a `Button` already.

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
- [ ] Folder rows: `web/src/shell/folder-picker.tsx:289–303, 364–394` (keep double-click). The
      star beside a favourite is a `Button` already.
- [ ] File tree rows: `extensions/git-history/file-tree.tsx:60–101`. The row is the indent
      (`paddingLeft` from the depth), and the folder row's name is not `flex-1`.
- [ ] Every row that is a link takes `asChild` over the `a` and keeps its plain-click guard, so
      Cmd-click and open-in-new-tab still work: the session row's link
      (`web/src/shell/sessions.tsx:277`), a home row's link (`web/src/shell/home.tsx:38`), and the
      subagent links (`extensions/subagents/web.tsx:102`, `:159`, `:273`).
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

Replacing these costs more than it saves: each one is a choice of cost against benefit, not a gap
in `Button`. The list closes with the `title=` readouts that are not actions and stay.

- **Resize handles** — two handle buttons and one focusable separator `div`:
  `web/src/shell/panels.tsx:121–178`, `web/src/shell/sessions.tsx:194–214`,
  `web/src/shell/sidebar-bottom.tsx:127–151` (that last one is the `div role="separator"`). A handle
  is a 8px strip with no text, whose pointer capture, keyboard steps, double-click reset, and
  persisted width are the whole of it: a `Button` would buy a focus ring and a hover fill these
  already paint, at the price of fighting its size and its centring. shadcn `Resizable` would cost a
  new dependency and a layout rewrite.
- **Drop overlay** — `web/src/composer/drop-overlay.tsx`: a non-modal drag cue. No primitive fits,
  and a `Button` is a control, not a cue.
- **The composer's textarea** — `web/src/composer/composer.tsx:574`: the card around it is the frame,
  so `Textarea` would come as a reset list — `border-transparent bg-transparent px-0 py-0
  focus-visible:ring-0` — and give back only `text-ink`, `placeholder:text-faint` and an
  `aria-invalid` look the field never asks for. Its focus treatment is the card's
  `focus-within:border-accent`, one indicator where the primitive's ring would be a second one
  inside it, and its height is `field-sizing: content` with `min-h-[2lh]`: the primitive carries no
  height at all, since a textarea is otherwise as tall as its `rows` say.
- **Lightbox close target** — `web/src/ui/lightbox.tsx:101–108`: a full-screen click target for
  closing next to zoom and pan. It is deliberately not a `Button`: the hit area is the whole
  viewport, and a box with a hover fill would read as an action in the middle of the picture. The
  viewer itself already is a `Dialog`, so Escape and focus return are the primitive's.
- **Timeline marks** — `web/src/transcript/activity.tsx:160–178`.
- **Attachment** — `web/src/components/ui/attachment.tsx`: our own primitive, already shared. Its
  overlay trigger and its 20px action button keep their size and hover, so a call site changes only
  their `title`, to a `Hint`.
- **Collapsible** — `web/src/components/ui/collapsible.tsx`: the measured `data-beyond` content
  stays.
- **Sessions-status submenu** — `web/src/shell/sessions-status.tsx:120–187`: two-tap touch
  activation and inline narrow submenu are deliberate.
- **Tag colour dots** — `extensions/tags/details.tsx:33–48, 158–171`: a 16px or 12px circle filled
  with the tag's own colour, a colour picker rather than a text button. A `Button` would give it back
  every look the dot does not want (size, radius, hover fill, weight) and still leave the disabled
  dot to stay at 50% beside its filled neighbours. Their `title` is the hue's name, not an action.
- **Theme preview bars** — `web/src/shell/appearance-dialog.tsx:180–184`: an illustration, not a
  meter.

### `title=` that stays

The rest of the `title=` left in the app is a readout, not an action: it either shows text the
layout truncates or a detail the row has no room for. None of them is worth a tab stop, and the
ones that belong to a later primitive go with it.

- Shown because the text is cut off, no owner: a file name or path
  (`web/src/ui/attachments.tsx:85`, `:126`, `extensions/git-history/file-tree.tsx:80`), a folder
  path (`web/src/shell/sessions.tsx:691`, `:711`, `:748`, `web/src/shell/home.tsx:40`), a commit
  subject (`extensions/git-history/web.tsx:1172`), a tag name and the tags it hides
  (`extensions/tags/web.tsx:31`, `:40`), a file size (`extensions/files/panel.tsx:233`).
- A detail a row shows on hover, no owner: the exact commit time
  (`extensions/git-history/web.tsx:469`, `:609`), a note's error (`extensions/notes/panel.tsx:242`),
  a tag's session count (`extensions/tags/details.tsx:225`), the page behind the browser's address
  (`extensions/browser/panel.tsx:459`).
- A pill or a chip that [Badge](#25-badge-installed-reduced-to-one-look) rewrites:
  `extensions/git-branch/web.tsx:56`, `extensions/git-worktree/web.tsx:95`, `:107`,
  `extensions/git-stats/web.tsx:93`, `extensions/git-history/web.tsx:1063`, `:1073`, `:1151`,
  `extensions/tags/details.tsx:39`, and the agent chip at `extensions/subagents/web.tsx:104`, which
  [Item](#39-item-new) takes with its row (`:276`).
- The three resize handles' `title="Drag to resize, double-click to reset"`, which explains the
  control and stays with it.
