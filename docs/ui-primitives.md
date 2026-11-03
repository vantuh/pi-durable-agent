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
- [x] Optional content `Kbd` slot inside a tooltip, for the shortcut that triggers the action
      (see [Kbd](#310-kbd-new)): `Hint`'s `keys`, placed after the label in a row with an 8px gap. A
      slot rather than a string, because a chord is more than one cap and the caller knows which it
      has; left out, the label is the tooltip's whole content, as it is for every hint with no key.
      The composer's Send is the first caller, `extensions/hotkeys` the second.

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
      and the flow itself waited for [AlertDialog](#34-alertdialog-new).
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

- [x] Add `components/ui/progress.tsx`. Radix's `Progress` brings the `progressbar` role,
      `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, and `aria-valuetext` as a percentage. The
      tones are `accent` (the default), `warn`, and `danger`: the three the callers were already
      choosing between. Size and name stay with the caller, `className` for the geometry and
      `aria-label` for the name, because every host labels its meter with its own words. The
      indicator is filled by width, the way the hand-written meters were, not by the shadcn
      `translateX`: the two draw the same bar, and the width is what the sites already wrote. The
      root is a `span` through `asChild`, because three of the four hosts are a button or a span,
      which take phrasing content only, as the timeline rule needed.
- [x] `web/src/ui/status-fields.tsx:48–58`. The field's meter is a `w-9` `Progress`, 36×4 as before,
      in the field's own tone, named by the field's `label` or by the extension's folder name when
      the field has none. No installed extension writes a meter today, so this site was checked by
      reading it and by the primitive's other hosts, not on screen.
- [x] `extensions/context-meter/web.tsx:37–38` (the per-part bar at `56` only if it is one
      value; a segmented bar stays custom). The status bar's meter and the popup's are `w-9` and
      `w-32` `Progress`es, 36×4 and 128×4 as before, both named "context"; the trigger reads
      132.02×24 either way. The per-part rows stay custom: each bar is that part's share of the
      biggest row, not a value on its way to full, so it keeps its `aria-hidden` while the row's
      numbers beside it say what it is.
- [x] `extensions/subagents/web.tsx:135–140`. The chip's meter is a `w-7` `Progress`, 28×4 as
      before, accent or warn by the same line, named "<agent> context": the strip holds one chip per
      agent, so "context" alone would not say whose. The meter's box is unmoved, so the chip is
      249.3×36 still.
- [x] `extensions/usage-limits/web.tsx:46–52`. Both bars are `Progress`es: the status bar's `w-9`, 36×4
      as before, and the popover row's `h-1.5 w-full`; the tone lines at 70 and 90 and the rounded
      percentage are what they were, and each bar is named by the bucket's label, "5 hours". The
      popover could not be opened without the usage refresh that calls the provider, so its row was
      checked by its classes and by `tailwind-merge` dropping the base `h-1` for `h-1.5`, not on
      screen.
- [x] `extensions/browser/panel.tsx:328–330`. Nothing to migrate: the panel holds no fill meter,
      and the line the audit named is the console's box. Its loading state is the toolbar's Stop in
      place of Reload and the words "Starting the browser…": an indeterminate state with no bar,
      which `Progress` at `value={null}` would draw as an empty track, a look the panel never had.
      Nothing there has a value to name.

Two of the four hosts are buttons, and ARIA gives `button` presentational children: a screen reader
hears the button's own label, "context 19%" and "5 hours 16%", rather than the bar inside it. Those
two keep the role and the value for the markup's sake and for one implementation of the bar; the
gain in reading is on the popup's meter and the subagents chip's, which are announced on their own.

## Phase 3: overlays and structure

### 3.1 Popover (new)

Collision-aware placement, outside-click and Escape, focus return.

- [x] Add `components/ui/popover.tsx`. The content is the dropdown's surface — `rounded-control`,
      `border-edge-soft`, `bg-panel`, `shadow-lg`, `z-50`, `collisionPadding={8}` — with no padding
      or width of its own: a popup holds prose, rows or a form, and each frame is the caller's. The
      anchor is exported for the rename form, which the row's menu item opens. No animation: the
      repo has no `tailwindcss-animate`, and the theme has no motion for a popup.
- [x] `extensions/keep-warm/web.tsx:143–180` — native `<dialog>`. The trigger is the `Button`
      through `PopoverTrigger asChild`, inside its `Hint`; opening also re-reads the clock. Gone:
      the portal, the `bottom`/`left` math, the two document listeners, the `rounded-xl` and the
      `max-w` fallback. New: opening moves focus into the popup (the first control is the Switch),
      Escape closes and returns focus to the warm button, and the popup re-centres itself on a
      phone instead of being pinned at 8px.
- [x] `extensions/mcp/web.tsx:130–150` — native `<dialog>`. Same trigger shape as keep-warm's; the
      rows, the switch per server, the spinner and the `max-h-33` scroll area are unchanged. Gone:
      the portal, the placement math, the two listeners, the `max-w` fallback. The item is off on
      this machine, so the change was read rather than opened.
- [x] `extensions/usage-limits/web.tsx:186–216` — native `<dialog>`. The trigger and the rows keep
      everything they had; opening still calls `usage.refresh()` and closing still does not, now in
      `onOpenChange` instead of a click handler that read the old state. Gone: the portal, the
      placement math, the two listeners, `POPOVER_WIDTH`, the `rounded-xl` and the `max-w` fallback.
      The `border-edge` it carried went too: one popover wears `edge-soft` like the menu family.
- [x] `extensions/git-stats/web.tsx:113–160` — `role="dialog"` panel. Its Push trigger is a
      `Button` with a `Hint` that also says why it is disabled: `aria-disabled` instead of
      `disabled`, so the button stays focusable and the hint can show, and `onOpenChange` keeps the
      guard the `disabled` attribute used to be. The confirm is a primary `Button`. Focus lands on
      the panel's close first, so a second Enter closes instead of pushing. Gone: the `relative`
      wrapper, the absolute `top-9 right-0`, the `role`/`aria-label` pair, `z-30` and `rounded-xl`.
      The error keeps its `role="alert"` on the message and moves to [Alert](#37-alert-new) later.
- [x] `extensions/context-meter/web.tsx:118–120` — popup. **Hover became click**, as the orchestrator
      decided for this step: one behaviour for every popup (click, Enter or Space opens; Escape and an
      outside click close; focus returns), and no `HoverCard`. Gone: the `onMouseEnter`/`onMouseLeave`
      wrapper, `onFocus`/`onBlur`/`onClick` and the `rect`/`left`/`bottom` math with `POPUP_WIDTH` and
      `GAP`. The frame is the primitive's now, so `bg-canvas` and `rounded-card` went with it and the
      card is `bg-panel` like the menu family; the width is the caller's (`w-160`, capped by the
      primitive's `max-w-(--radix-popper-available-width)`: 40rem on a desktop, the viewport inside the
      8px collision padding on a phone) and the rows, the folds and the `max-h-[70vh]` scroll area are
      unchanged. The keyboard can reach the folds now: focus enters the popup, whose first stop is the
      first fold.
- [x] `web/src/shell/sessions.tsx:1130–1182` — rename form. The row is the `PopoverAnchor` and the
      popover's `open` is the row's id in `Sessions`, because the menu item that starts a rename goes
      away with its menu; the form is its own `RenameForm`, mounted only while the popover is open, so
      the draft starts from the session's name each time. Autofocus and select-all are the
      primitive's: the first stop in the content is the field, and `FocusScope` selects what it
      focuses. Enter still submits the form, Escape still closes, Save still waits on `pending`, and
      `onCloseAutoFocus` gives focus back to the row's actions. Gone: the `place` math for this panel,
      `form.current`, `absolute inset-x-2`, `lg:left-full`, the ref callback that focused on every
      render and the field's own Escape handler. Placement is `bottom`/`start`: under the row, where
      flip can move it above one near the bottom of the window — `right` cannot, because Radix shifts
      a popover only on its own axis and a row 4px from the screen edge holds no room for 256px. The
      row is where the form lives, so a session the list draws no row for — one started from another,
      or one a folder, archive or search filter hides — gets the same `RenameForm` in a `Dialog`
      instead: `session.rename` anchors the popover when the row is on screen and opens the dialog
      when it is not, and the id it renames is the open session's, never the parent's.
- [x] `web/src/composer/composer.tsx:726–739` — the model chip stays a `Button` that opens the dialog,
      and the model menu stays a `Dialog`. It is not a popup: `ModelMenu` is two tabs, a search field,
      a list of every model of every provider, a thinking-level picker and per-row add, remove and
      "Make default" actions, with its own Enter, arrow and chosen-mark state. The dialog is the frame
      that fits it — centred, focus-trapped, as tall as the screen allows, and on a phone above the
      keyboard rather than hanging off a chip that sits a few pixels from the bottom edge. Nothing
      about the dialog costs the phone user anything, so there is no reason to move it.

### 3.2 DropdownMenu (installed, bypassed)

- [x] `dropdown-menu.tsx`: export `CheckboxItem`, `RadioGroup`/`RadioItem`, `Label`,
      `Separator`, `Shortcut` when a caller needs them. Added `RadioGroup` and `RadioItem`, the one
      choice the send modes need: the chosen mark (`Check`, `text-accent`) sits in a `pl-9` gutter of
      its own, so a label with a description under it keeps the item's whole width. `Separator` was
      already exported and already had its caller (`sessions.tsx`). No caller wants `CheckboxItem`,
      `Label`, or `Shortcut`, so none was added.
- [x] `web/src/composer/composer.tsx:762–830` — send-mode menu as `RadioGroup`; arrow keys and
      typeahead replace the custom focus/blur dismissal. The split chevron is the
      `DropdownMenuTrigger`, inside its `Hint`; Radix owns `aria-haspopup` and `aria-expanded` now, so
      the hand-written pair went. Each item keeps its label and its description, the menu keeps `w-64`,
      and it opens above the trigger (`side="top"`, `align="end"`) inside the viewport at 390×844.
      Picking a mode still only selects it. Gone: the `<ul>`, the wrapper's `onBlur`, and
      `modesOpen` — the menu is unmounted with the trigger when the run ends, which is what the
      `!busy && modesOpen` reset did. New: Escape and an outside click close it, arrows and typeahead
      move the mark, and `onCloseAutoFocus` puts the caret back in the textarea, where the old menu
      left focus on the body.

### 3.3 Command (installed, bypassed)

- [x] `web/src/composer/composer.tsx:516–556` — slash-command completion, and the `@`-mention list
      beside it. Focus stays in the textarea, so the site could take the primitive: `Command` with
      `shouldFilter={false}` (the candidates arrive already ranked by `fuzzyScore`) and a controlled
      `value`, which the textarea's arrow keys move. cmdk's own key handler only sees keys bubbling
      from inside its subtree, and a controlled value never moves focus, because cmdk moves it only
      when the active element is its input or its root — neither is ever focused. The hand-written
      marking went with the `ul`/`button`: `CommandList` is the `listbox`, each `CommandItem` an
      `option` carrying `aria-selected` where `aria-current` was, `disablePointerSelection` keeps a
      hover a hover, and the `onMouseDown` guard that keeps the caret in the textarea stays — now on
      the root too, so the popup's own 4px padding cannot take focus either.
      Not gained: `aria-activedescendant` on the textarea. The only id cmdk exposes for an option is
      the store's `selectedItemId`, written inside `setState("value")`, and a controlled `value`
      bypasses it (`if (R !== void 0) { n.current.value = e; E.emit() }`, `cmdk/dist/index.mjs:1`), so
      `useCommandState` reads `undefined`; the list's and the options' ids are generated anyway, and
      `id: b.listId` / `id: n` overwrite whatever a caller passes. Reaching them would mean querying
      cmdk's own markup, so the textarea stays a plain textarea rather than a half-built combobox.
      The scroll into view stays hand-written for the same reason: cmdk's scroll slot runs only on its
      own value changes (`v(5, ne)` inside `setState`), so an outside driver would leave the mark
      below the fold. Measured unmoved: the popup 990×256 at 1280×800 and 372×256 at 390×844, a row
      965×34.5, the mark following the arrows into view at both sizes. The frame carries `max-h-64`
      and `overflow-hidden` and the list scrolls inside it, because the border moved from the
      scrolling element to the frame and the 256px cap had to stay on the frame to keep the height.
      Look: a 15px mono name in a 34.5px row was larger than every other menu's, which is `text-meta`
      in `px-3 py-2`. The row takes the family's sizes — a 12px mono name, a 12px faint description
      (`text-meta`, the smallest size the theme names), `px-3 py-2` — and measures 34px, 12px, 12/8/8
      padding, exactly what a `DropdownMenuItem` in the sidebar's row menu measures. The description
      was 11px by hand and is 12px now: its line box grew 1.5px and its baseline stayed where it was,
      so the row is the same 34. The frame and the `max-h-64` cap are unmoved, so 7.5 rows show
      instead of 7.4.

### 3.4 AlertDialog (new)

- [x] Add `components/ui/alert-dialog.tsx`. The overlay and the surface are `dialog.tsx`'s; the card
      is sized to a question — `max-w-md`, centred, with its margins at every width — where a dialog
      fills the screen below `sm` because it holds a body. `AlertDialogFooter` is
      `flex-col … sm:flex-row`, not the dialog's `flex-col-reverse`: Cancel is first in the DOM
      because it is the first tab stop and the focus on open, and it must stay the first on screen
      too. `Action` and `Cancel` are our `Button` through `asChild`, `danger` and `ghost` unless the
      caller says otherwise. A caller whose answer waits calls `event.preventDefault()`: `Action` is
      the primitive's `Close`, so without it the question would close on the click and not on the
      answer. `Trigger` was exported with the rest of the family and had no caller: neither site opens
      one from a trigger, so it went.
- [x] `web/src/shell/sessions.tsx:1184–1220` — delete confirmation; keep the pending state. The row
      mounts its own `AlertDialog` beside its rename popover, because the actions trigger that has to
      take the focus back is there: `onCloseAutoFocus` preventDefaults and focuses it, the one line
      the rename popover already needed. Gone: `role="alertdialog"`, the `ref` that called
      `node?.focus()`, and `place` with its `useLayoutEffect` and `dialog` ref — the last user of the
      placement math; `rowNodes` stays for `session.rename`'s scroll into view. The wording is the old
      sentence split into a title and its line, `Delete “X”?` over `It disappears for good.`, and the
      answers are the same `No` and `Yes, delete` at the button's own size instead of the narrow
      panel's `sm`. The pending state stays: both answers disabled, the label reads `Deleting…`, and
      neither Escape nor `No` closes the card until the delete returns. The toast and the navigation
      away from a deleted session are App's, unchanged. What moved: the panel was anchored at the
      row's height and is a centred modal over an overlay now.
- [x] `extensions/git-worktree/web.tsx:116–175` — remove-worktree flow. The same content, the same
      `Removing…` and the same error line; the hand-written `danger` `Button` is `AlertDialogAction`
      and the `ghost` one is `AlertDialogCancel`, without the `font-medium` and the
      `flex-col sm:flex-row` override the footer carries now. The `!removing` guard in `onOpenChange`
      keeps Escape dead while the removal runs. No session on this machine works in a worktree, so
      the pending pair, the refusal keeping the card open, and Escape in between were measured in a
      throwaway page that mounted the primitive with a call that rejects — deleted afterwards.

### 3.5 Sheet (new)

- [x] Add `components/ui/sheet.tsx` on top of the dialog primitive: `Sheet`,
      `SheetClose`, `SheetContent`, `SheetTitle`. The overlay is `dialog.tsx`'s, slot and all, so the
      scrim fades with the 150ms the dialog's does. `SheetContent` draws no button of its own, where
      the shadcn sheet carries an X in a corner: the settings sheet keeps its close in its header
      row, and a second one would move the first tab stop into the body. The motion is the
      stylesheet's `[data-slot="sheet-content"]` (`panel-in`/`panel-out`, 200ms, already 1ms under
      `prefers-reduced-motion`), so no `tailwindcss-animate` and no new keyframes. `side` is a record
      with `right` only, the one caller's edge; `top`, `bottom` and `left` wait for a caller.
      `SheetHeader`, `SheetDescription` and `SheetFooter` are not exported: the settings header is its
      own row with the close button in it, it has no description, and its footer belongs to
      `settings-content.tsx`. `SheetTrigger` had no caller either — the gear that opens the sheet
      is outside it, which is why the sheet still states its own return-focus target — and it went
      with `AlertDialogTrigger`.
- [x] `web/src/shell/settings.tsx:20–60` — direct Radix Dialog → Sheet; keep the explicit
      return-focus target. The header's close is a `Button` already, and is a `SheetClose asChild`
      inside the same `Hint`. Unmoved: 360×744 at (912, 8) at 1280×800 and 374×828 at (8, 8) at
      390×844, `rounded-card`, one `edge-soft` border, `panel-in` on open; Close is the focus on
      open, Escape, the close button and a click on the scrim all close, and the gear takes the focus
      back. One look changed: the scrim is `sunken` at 70% like the two dialogs', not the sheet's own
      40%, since one overlay is one element. [layout.md](layout.md) says so now. Escape reaches the
      sheet on the second press while the close button holds the focus and its `Hint` is showing: that
      was true of the dialog it was built from, and is not the Sheet's.

- [x] `extensions/git-history/web.tsx:1219–1270` — sliding panel. **Stays custom**, and it is not an
      edge panel at all: no overlay, no focus trap, no Escape, and the page stays live behind it. It is
      a second pane pushed over the first inside the git-history page (a `transition-transform` on two
      `aria-hidden`/`inert` siblings), addressed by `?page=history&sub=…`, so Back, the frame's own
      Back button and a review's address all move it (`navigate`, `parentSub`). A sheet would answer
      all three with a modal: its overlay would cut the page out of reach of the list behind it, its
      Escape would fight the frame's, and its own unmount would throw away the address-driven place
      that survives a re-open. Kept.
- [x] Decide after the two above: `web/src/shell/panels.tsx:190–204, 305` and
      `web/src/shell/sessions.tsx:984–992` on narrow screens only. Wide screens keep the resizable
      panel. **Both stay custom.** Neither is a dialog: both mount the one component that also fills
      the desktop column, the same `aside` with the same children, and only the classes change at
      `lg`. A sheet mounts its content in a portal that Radix unmounts when closed, so the sidebar
      would lose its list scroll, its search state and its place at every breakpoint change, and a
      panel would lose its body — a live browser view inside it is thrown away by a remount, which is
      why the panel is already kept mounted and slid out with `panel-in`/`panel-out` (the motion the
      sheet reuses was written for it). Radix's overlay also takes the app out of reach: the panel
      host is a sibling column on a desktop, and the status bar, the conversation and its own close
      button have to stay usable while it is open.

### 3.6 ToggleGroup (new)

- [x] Add `components/ui/toggle-group.tsx`, with the flavour cards of the appearance dialog as its
      first caller. Radix's `type="single"` emits `role="radiogroup"` over `role="radio"` items
      carrying `aria-checked`, not the `aria-pressed` the hand-written buttons had, and it lets the
      pressed item be pressed off again: a caller that must always have one value ignores the empty
      one. The item carries the look the three groups share — `rounded-control`, `text-interface`, the
      raised fill and ink of a pressed control, muted when not, read off `data-[state=on]` — and the
      caller keeps the padding and the layout, so the segmented rows and the card grid are unmoved.
- [x] `web/src/shell/appearance-dialog.tsx` — flavour (`65–83`, with the primitive), sidebar width
      (`110–123`), layout (`143–155`). The palette gear above them is a `Button` already. Each group
      keeps the value it reads at mount and the call that persists it: `flavour` and `width` in
      localStorage, `diff-layout` as a key plus an event its viewers listen to. What changed is the
      keyboard and the announcement: the dialog's ten tab stops are five, one per group and one for
      the close, and a group is entered on the item it has pressed; arrows move the focus inside a
      group, Space or Enter presses, and the dialog's open-focus rule reads
      `[role="radio"][aria-checked="true"]` instead of the `aria-pressed` that is gone. The groups are
      named `Theme`, `Width` and `Diffs` so a `radiogroup` is announced with the label its row already
      shows. Measured unmoved at 1280×800 and 390×844: a flavour card
      112.5×132.5 and 177×132.5, a segmented item 30.5 tall in a 196.28×34.5 pill, the same fills,
      radii and paddings. The flavour card's focus ring is its own (`outline-ink` over the accent
      ring of the pressed card); the segmented items keep the browser's ring they had, since neither
      the primitive nor the caller gives them one.

### 3.7 Alert (new)

`role="alert"` so the error is announced.

Each site below is judged for its role: a failure the person caused or must act on keeps
`role="alert"`, and a passive note becomes `role="status"` so it does not interrupt what is being
read. Its geometry follows what it covers: a block inside content takes the primitive's padding and
its 6px radius, and one that is a pane's whole body or a full-bleed strip between two rules keeps
square corners (`rounded-none`) and the caller's own padding, so no edge a border delimits moves.

- [x] Add `components/ui/alert.tsx` with `warn` and `danger` tones, the two the call sites were
      already choosing between. A tone is a wash and its text colour, with no frame: `bg-danger/10` over
      `text-danger`, `bg-warn/10` over `text-warn`, which is what the two blocks that already existed
      wore. `rounded-control` replaces their `rounded-lg` (8px → 6px), the theme's one radius for a block
      that is not a card, and `px-3 py-2`, `gap-2` and `text-meta` are theirs too. A leading `<svg>` is
      14px and takes the tone's colour, so a caller writes the icon and nothing else. `role="alert"` is
      the default and `role="status"` the stated override. No `AlertTitle` / `AlertDescription`: the one
      site with a title over a detail is a column of two spans the caller keeps.
- [x] `web/src/transcript/transcript.tsx:235–251` — provider error. This block was the reference
      look and keeps it: the icon, its 2px offset and its colour are the primitive's now, and the 6px
      radius is the only change. It gains the `role="alert"` it never had — a provider failure the person
      is waiting on is announced when it lands. The title inherits the tone's red and the detail keeps its
      faint mono.
- [x] `extensions/anthropic-subscription/account-details.tsx:79–88` — the check's failure and the
      account state it can return. The failure keeps `role="alert"`: the person pressed the button
      and it did not work. The `unavailable` result is `role="status"`: the click worked, and what
      it found is a provider's state rather than an error of the screen, so it need not interrupt.
      Both gain the wash, and the warn one the tone's yellow.
- [x] `extensions/anthropic-subscription/details.tsx:49`, `109–116` — the poll's failure, and the
      version hint it can carry. The failure stays `role="alert"`: the person opened these details
      for diagnostics and none came. The hint is `role="status"`: a provider's version warning is
      read when looked at, and interrupting a sentence already being read for it would not help.
- [x] `extensions/auto-session-name/details.tsx:59–63` — the switch's failure, `role="alert"`: the
      person flipped it, the save did not happen, and the switch already moved back.
- [x] `extensions/subagents/profile-models.tsx:77–81` — a profile's failure, `role="alert"`: a save,
      a removal or a model list the person asked for came back empty.
- [x] `extensions/tags/details.tsx:109–113` — a tag's failure, `role="alert"`: adding, renaming,
      recolouring or removing one is the person's own click.
- [x] `extensions/usage-limits/details.tsx:61–65` — a provider's switch failing, `role="alert"`: one
      click, one save, and the switch went back.
- [x] `extensions/git-stats/web.tsx:165–176` — the push panel's error state, left inside the popover
      by [Popover](#31-popover-new). It is `role="alert"` (the default): the person pressed Push and
      it failed, which is the most urgent thing a 256px panel can say. The prompt it swaps with keeps
      its own `<p>`, since it is a question and not a notice. The error is 12px now where the popover's
      body is 15, the primitive's `text-meta`, and it wears the wash where it was red text.
- [x] `extensions/git-worktree/web.tsx:160–165` — the removal's failure inside the AlertDialog, which
      [AlertDialog](#34-alertdialog-new) left as a hand-written block (the same markup the transcript's
      was). `role="alert"` (the default) is the one role it wants and never had: the person confirmed
      a destructive answer and it did not happen, and the card stays open to say so. Its `mx-3 mb-1`
      stays with the caller, since it is the dialog's padding; the rest is the primitive's, with the
      8px radius becoming the theme's 6.
- [x] `web/src/shell/extensions-dialog.tsx:142–146`, `195–197` — the selected extension's problem
      over its details, and a list row's problem under its description. Both are `role="alert"`: a
      folder that failed to load, or a switch the person just flipped that did not save. The row keeps
      the id its switch points at in `aria-describedby`; the element carrying it is a `div` now, which
      `aria-describedby` reads the same. Measured on a throwaway page: the details block is exactly as
      wide as the line it replaces and 34px tall where that line was 18, the wash and the 6px radius
      being the whole of it; the row grows 83.5 → 103.5px, and its message sits 12px right of the
      description above it — the price of one look for one message, since the same text is an Alert a
      click away.
- [x] `web/src/shell/extension-details.tsx:46–48` — the boundary's fallback when a details module
      fails to load, `role="alert"` (the default): a panel that threw while rendering is a failure, not
      a note. It sits where the details would, so the primitive's own padding and radius are the block
      that stands in for a section.
- [x] `extensions/git-history/web.tsx:193`, `345–348`, `787–792` — the reword form's failure, a
      pane's read failure and the review's own failure. All three are `role="alert"` (the default): a
      save, a read or a review the person asked for came back with nothing. The reword error takes the
      primitive whole, inside the form's own column: 1183×18 of bare 12px text becomes a 1183×34 block
      with the tone's wash and its 6px radius, the only site of the three whose box grew. The other two
      are a pane's whole body, so they keep the pane's edges and padding — `rounded-none` with `p-3` and
      `p-4` — and their 15px text: measured in a full-width column, 1207×46.5 and 1207×54.5 before and
      after, unmoved, with only the wash added.
- [x] `extensions/git-history/web.tsx:743–748`, `1121–1126`, `extensions/git-history/preview.tsx:428–430`
      — the two issue banners and the diff preview's parse failure, all `role="alert"`. The banners are
      full-bleed strips that rule off a toolbar, so they keep square corners (`rounded-none`), their own
      `px-3 py-2`, their 15px text and their `border-b` edge: measured in the same column, 1207×39.5 with
      a 1px `edge-soft` rule before and after, the wash in place of the bare red words. The preview's
      failure is a pane body like the two above — `rounded-none` and the primitive's padding, which was
      already the 12px it carries.

These are the error lines that had no live role at all, so the first pass over `role="alert"` never
saw them. The rule is the one above: a block that says something failed becomes an `Alert`, and a
line that is a row's detail or a status line that only turns red may stay text with its reason.

- [x] `web/src/shell/extensions-dialog.tsx:114–122` — the list's own read. It was one line that was
      faint while loading and red when the read failed; it is two now. The failure is `role="alert"`:
      the person opened Extensions and nothing came, in a dialog that has no other body. It keeps the
      line's `animate-drop-in` and `p-3` and takes `rounded-none`, as a pane's whole body does; the
      loading line stays a faint paragraph, since "Loading…" is not a notice.
- [x] `web/src/shell/folder-picker.tsx:290–294` — "Cannot read that folder." in place of the folder
      list, and `role="alert"`: the person opened a folder and it could not be read, so the list they
      came for is empty. It is the whole body of a framed, scrolling region — a `border` and
      `rounded-control` box that holds rows at `p-1` — so it keeps the primitive's padding and radius
      inside that 4px and gains the wash where it was red text: measured 1238×34 either way, the padding
      going from 8px all round to `8px 12px` and the 6px radius in place of a square corner.
- [x] `web/src/transcript/transcript.tsx:289–291` — the reason under a "compaction failed" mark,
      `role="alert"` (the default): the person asked for a compaction and it was refused. It keeps the
      mark's centring, which the primitive's flex row would otherwise lose — the text node is an
      anonymous item sized to its content, so `justify-center` places it and `text-center` centres the
      second line when it wraps. Measured at 390: 332×36 of centred text becomes a 332×52 block at 6px
      with the same centred lines, and unmoved above it the `danger` badge that already names the
      failure.
- [x] `extensions/mcp/details.tsx:64`, `68–75`, `110` — the first read's failure, a problem in
      `mcp.json`, and a switch whose save failed. The two failures are `role="alert"`: they are a
      click's answer. The config problem is `role="status"`: it is what the file says, found on mount
      rather than caused there, so it is announced when there is room rather than over what is being
      read. All three take the primitive whole — they are blocks in the details column at 12px, and the
      wash replaces red text of the same size, the bare lines growing from 18px to 34.
- [x] `extensions/mcp/web.tsx:90–99` — the same `mcp.json` problem at the top of the status bar's
      popover, so `role="status"` for the same reason. The popover is `w-72 p-1` with rows at `px-2`,
      so the Alert keeps `px-2 py-1.5`: measured, the wash sits where the red words did, 12px from the
      popover's edge like every row's text, at the rows' own 6px radius.
- [x] `extensions/push/web.tsx:192` — the error under "Enable on this device", `role="alert"`: the
      button is the whole section, and the same line also carries the state read that runs on mount. The
      block takes the primitive whole; it is the section's body at 12px, so the wash replaces red words
      of the same size, and the 18px line becomes a 34px block.
- [x] `extensions/bash-timeout/details.tsx:105–106`, `135` — the first read's failure and a save's,
      which are the same `error`: `role="alert"` for both, since one is the panel that would not open and
      the other is the number the person typed coming back unchanged. The first replaces the panel's
      whole body; the second sits under the field, where the primitive's own padding and radius are the
      block that was red text.
- [x] `extensions/browser/panel.tsx:510–512` — the strip under the browser's toolbar, `role="alert"`:
      its `error` is an operation the person started that failed, and `page.problem` arrives with it. It is
      a full-bleed strip between the toolbar's `border-b` and the stage, so it keeps square corners
      (`rounded-none`) and its own `px-3 py-1.5`: measured 1248×30 with `6px 12px` of padding before and
      after, unmoved.
- [x] `extensions/git-history/web.tsx:675–691` — a pane that has no such commit, or whose read failed. It
      was one paragraph that turned red and took `role="alert"` when it was a failure; it is two now. The
      "not here" note stays a muted `<p>` with no live role, because it is a note about a place, not an
      error. The failure is `role="alert"` and keeps the pane body's geometry — `rounded-none`, `p-3`,
      `text-interface` — so at the same measured 1207×46.5 only the wash is new.

A full sweep of `text-danger` and `text-warn` across `web/src` and `extensions/` — the first list was
cut short by a `head` — found these too.

- [x] `extensions/git-worktree/web.tsx:259` — the New session dialog's refusal, under the worktree
      name, `role="alert"`: the person asked for a worktree and the session was not made. It keeps the
      id the name field points at in `aria-describedby`, which reads a `div` the same, and takes the
      primitive whole — it is a line under the field, 18px of red text becoming a 34px block.
- [x] `extensions/notes/todos.tsx:247` — a to-do item's failure, between the add form and the list,
      `role="alert"`: adding, ticking or removing one is the person's own click. It is a full-bleed strip
      of the panel, so it keeps square corners and its `px-3 py-1`, and its 15px text.
- [x] `extensions/notes/panel.tsx:267` — a note's failure, under its tabs, `role="alert"`: the note's
      read or write did not answer. It is a full-bleed strip of the panel with the primitive's own
      `px-3 py-2`, so only the corners change, to square, and the 15px text stays.
- [x] `extensions/files/panel.tsx:172`, `228` — the tree's read failure, and the viewer's, both
      `role="alert"`: a read the person asked for by opening the panel or a file. The tree's is a
      full-bleed strip under its header, so it keeps square corners and its `p-3`; the viewer's sits
      inside the scrolled `p-3` with its own line, so it takes the primitive whole.
- [x] `extensions/usage-limits/web.tsx:161`, `171` — a refresh's failure, and one provider's error
      inside its own card, both `role="alert"`: they are what the refresh the person pressed came back
      with. The first keeps its `mb-2` and takes the primitive whole; the second sits in a provider's
      `rounded-lg border p-2`, so it takes the primitive whole too, at 12px in a popover that is 12px.
- [x] `extensions/keep-warm/web.tsx:123` — "Last ping …", which turns red when the ping failed.
      **Stays text**: it is the third line of the popover's own readout column — when the last request
      went out, when the next will, and what the last one cost — so the failure is the same line with its
      error appended, not a block of its own, and a wash around 12px of a three-line readout would read
      as a different kind of thing than the two lines above it.
- [x] `extensions/git-history/web.tsx:373–378` — the caveat under a diff's counts when the preview is
      cut short. **Stays text**, `text-warn` on a 15px note: it is a readout of the preview's own limit
      rather than a failure, it sits in the diff's header column beside the counts and "No changes.",
      and a wash there would frame one line of a header whose other lines are plain body text. It keeps
      no live role for the same reason — nothing failed.

The rest of what a tone colours is a mark, not a block: a diff's `−` count (`web/src/ui/diff.tsx:276`,
`extensions/git-history/preview.tsx:238`, `extensions/git-history/web.tsx:368`,
`extensions/git-stats/web.tsx:120`), git-stats' ahead/behind pair (`:123`), the browser's error count in
its toolbar (`extensions/browser/panel.tsx:507`), a status bar field's label
(`web/src/shell/status-bar.tsx:62`), and a server row's own detail line
(`extensions/mcp/details.tsx:88`). Each is one value inside a row or a readout that a frame would pull
out of its line, so all of them stay text.

### 3.8 Empty (new)

- [x] Add `components/ui/empty.tsx`, with `web/src/shell/home.tsx` as its first caller. Four sites, four
      muted sentences: `Empty` is the container alone, `text-meta text-faint` and the caller's own
      padding. No `EmptyMedia`, `EmptyTitle`, `EmptyDescription` or `EmptyContent` — no state below has an
      icon or a second line, and the one that stands beside a button (the browser's empty pane) centres
      that button in a column the caller already writes. Not a default `role` either: an empty state is a
      readout, and the one a search drives states `role="status"` at its site. The element is a `div`
      where the sites were `p`: same box, and no site's CSS looks for a paragraph.
- [x] `web/src/shell/home.tsx:111–113` — the empty sessions list. Unmoved: 12px on an 18px line, faint,
      `px-2`, measured 105.17×18 before and after in a throwaway page, since a home with no sessions needs
      one deleted. It is the site's whole list, so it is a block of its own rather than a `<p>` in the
      column.
- [x] `web/src/shell/sessions.tsx:1226–1234` — no search results: none at all, none archived, or none
      matching the query. Unmoved: `px-2 py-3`, 12px on an 18px line, faint, measured 250×42 in the app
      with `zzzqqq` typed and 122.78×42 in a throwaway page, before and after. It is the one site with a live role, `role="status"`: the sentence replaces the list in
      answer to what the person is typing in the search field above it, so it is announced politely
      rather than interrupting the caret. No other site takes a role.
- [x] `web/src/shell/sessions-status.tsx:288–290` — the status bar's dropdown, when no session is at
      work. Unmoved: `px-2 py-1.5`, 12px faint, measured in a throwaway page at 138.53×30 at 1280 and
      125×48 at 390, before and after: every session at work meets a row, and a quiet afternoon is not
      something a check can ask for. It sits inside the menu but is not a menu item: no click, no focus stop, no `menuitem` role,
      only the sentence with the rows' own 8px side padding.
- [x] `web/src/transcript/transcript.tsx:677–679` — the prompt an empty session shows. It keeps
      `text-prose`: the conversation is prose at 15px, where the sidebar's own states are 12. Unmoved:
      15px on a 22.5px line, faint, no padding, measured 227.66×22.5 before and after in a throwaway page,
      since an empty session needs one created. It is not a live
      region: the session was empty when it opened, so nothing replaces anything.

The four above are the states the audit named. A sweep of every "nothing here" sentence in `web/src` and
`extensions/` found the rest. Each is judged by what it fills: a sentence that stands in for a region's
content, and that the person came to, is an `Empty`; a value inside a row, a readout column, or a box
whose parent writes the text's family and size stays text. None of the eleven below changes its box:
each was measured as the old `<p>` and the new `Empty` side by side in a throwaway page, at 1280 and at
390, because the states themselves need writes to reach. The two that wrap onto several lines measure
0.01px apart in the narrower column, which is text rounding rather than a box.

- [x] `extensions/mcp/details.tsx:77–79` — `No servers in mcp.json.`, the details column's body. It keeps
      `muted` rather than the primitive's `faint`: the sentence is a config file's answer beside the
      `problem` Alert above it. Unmoved: 12px on an 18px line, no padding, measured 132.55×18.
- [x] `extensions/mcp/web.tsx:101–103` — the same words at the top of the status bar's popover, which
      is 12px inside `text-meta w-72 p-1`: `px-2 py-1.5` like the rows around it. Unmoved: measured
      148.55×30.
- [x] `extensions/tags/details.tsx:133–137` — `No tags yet.`, where the list of tags would be. Only the
      empty branch moves; the `Loading…` above it stays a paragraph, since a read in flight is not a
      region with nothing in it. Unmoved: 12px faint in the column's `text-meta`, no padding, measured
      68.39×18.
- [x] `extensions/tags/web.tsx:60–64` — `No tags yet. Add them in Extensions.`, the whole body of a
      session's tag submenu, so not a menu item and not clickable: the two-tap touch activation is the
      submenu's, and the sentence stays inert inside it. Unmoved: 12px faint, `px-2 py-1.5`, measured
      223.8×30 at 1280 and 150.2×48 at 390.
- [x] `extensions/notes/todos.tsx:250–254` — `Nothing to do.`, the to-dos panel's list body at 15px,
      which it states as `text-interface`. The done section below renders nothing when it is empty, so
      there is nothing else to place. Unmoved: `px-2 py-2`, 15px on a 22.5px line, measured 113.63×38.5.
- [x] `extensions/notes/panel.tsx:217` — `This session has no folder.`, the notes panel's whole body.
      Unmoved: 15px faint, `p-3`, measured 205.06×46.5 at 1280 and 161×69 at 390.
- [x] `extensions/usage-limits/web.tsx:162–164` — `No signed-in provider reports limits.`, the popover's
      body when the answer holds no provider. The `Loading…` under it stays a paragraph. Unmoved: 12px
      faint in the popover's `text-meta`, no padding, measured 204.13×18.
- [x] `extensions/subagents/profile-models.tsx:81–87` — `No profiles yet: add a Markdown file …`, the
      settings section's body inside its own `text-meta` column, so 12px and no padding. Unmoved: two
      lines at 1280 and six at 390 in the throwaway page's columns, 595.2×36 and 150.19×108 either way.
- [x] `extensions/browser/panel.tsx:405`, `:518–530` — `Open a session to use the browser.` and the
      centred `Nothing is open.` over its `Open the browser` button. The second is the only empty state
      with an action beside it: `Empty` is its column (`flex flex-1 flex-col items-center justify-center
      gap-2 p-4 text-center`), the sentence is still the `<p>` it was, and the button is the caller's. Its
      `Starting the browser…` shares the box, since the same pane has nothing in it either way. Unmoved:
      the first 263.5×46.5 at 1280 and 125×91.5 at 390, the column 178.39×93 and 135.8×138.
- [x] `extensions/files/panel.tsx:267` — `Open a session to browse its files.`, the panel's whole body.
      Unmoved: 15px faint, `p-3`, measured 256.7×46.5 at 1280 and 161×69 at 390.
- [x] `extensions/git-history/web.tsx:681–686`, `:1183–1187` — `Nothing in this folder's history has that
      id. Open the history to pick a commit.` and `No commits or uncommitted changes yet.` The second was
      `text-muted p-4` and inherited the page's 15px; it now states `text-interface` itself. Both keep
      `muted`, the tone they had. Unmoved: the first 548.98×46.5 at 1280 and 128.59×159 at 390, the
      second 318.27×54.5 and 153.8×99.5. The `error` pane beside the first stays an `Alert`, and
      `Reading Git history…` above the second stays a paragraph.

What the sweep left as text, and why:

- [x] The four `Turn the extension on to …` lines — `extensions/mcp/details.tsx:60`,
      `extensions/tags/details.tsx:90`, `extensions/usage-limits/details.tsx:58`,
      `extensions/auto-session-name/details.tsx:57`. **Stay text**: they are a switch's state, not an
      empty list, and they read the same where the details column would be.
- [x] `extensions/browser/panel.tsx:409–414` — `No Chromium-based browser was found on this machine.`,
      **stays text**: it says the pane cannot work here and what to install, a prerequisite rather than a
      region with nothing in it.
- [x] `extensions/git-history/web.tsx:794–797` — `Review was cancelled.` and `Review is not running.`,
      **stay text**: a process's state in the column where `Reading Git history…` also stands.
- [x] `extensions/git-history/web.tsx:378` — `No changes.`, **stays text** for the reason
      [Alert](#37-alert-new) gives it: a readout beside the diff's counts.
- [x] `extensions/browser/panel.tsx:337` — `The console is empty.`, **stays text**: one line inside the
      console's own mono log box, whose parent sets the family, the size and the `p-2`.
- [x] `extensions/keep-warm/web.tsx:48` — `No request on the cache yet`, **stays text**: the popover's
      third readout line, as [Alert](#37-alert-new) ruled for the ping beside it.
- [x] `extensions/dictation/details.tsx:67` — `Nothing chosen`, **stays text**: a picker's value inside
      its row, not a region.
- [x] `extensions/anthropic-subscription/details.tsx:90–94` — `No requests yet`, **stays text**: a `<dd>`
      in the key/value readout, beside `Not attempted` and the rest of the field's values.
- [x] `extensions/anthropic-subscription/account-details.tsx:81` — `No Anthropic OAuth authorization
      configured.`, **stays text**: the answer the Check subscription button returns, the same slot as the
      `unavailable` Alert under it.
- [x] `web/src/composer/model-menu-dialog.tsx:169` — `No model matches.`, **stays a `CommandEmpty`**: the
      element is cmdk's and its look is `ui/command.tsx`'s, which already writes `text-faint text-meta`;
      an `Empty` inside it would nest two of the same thing, and one that is already the primitive's own
      defaults.
- [x] `extensions/git-stats/web.tsx:74` — `No upstream configured.`, **stays text**: it is a clause in a
      tooltip's description string, not a block.
- [x] Five regions show nothing at all rather than a sentence: the composer's queue
      (`web/src/composer/queued.tsx:51`), the composer's attachments (`web/src/ui/attachments.tsx:171`),
      the subagents strip (`extensions/subagents/web.tsx:180`), the keep-warm rows
      (`extensions/keep-warm/web.tsx:134`) and the git-history preview's empty diff
      (`extensions/git-history/preview.tsx:444`). Nothing to place.

### 3.9 Item (new)

One row: media, title, description, actions. Links stay links through `asChild`.

- [x] Add `components/ui/item.tsx`, with the sidebar's session link as its first caller. One container
      and four parts: `Item` (`flex items-center gap-2`, `rounded-control`, the theme's focus ring,
      `md` at `px-2 py-2` or `sm` at `px-2 py-1.5`, `asChild` so the row stays its `<a>` or `<button>`),
      `ItemContent` (the row's one column), `ItemTitle` (13px ink, truncated), `ItemDescription` (12px
      faint, truncated) and `ItemActions` (the row's controls at its end). No `ItemMedia`: the marks and
      icons sit in the row as the 8px and 16px elements they are, and a box around them would state a
      size they do not have. The fill a row takes under the pointer or while it is open stays with its
      family — a session row whispers at `raised/50`, a folder row fills, a queued card is already
      raised — and so does its font size, since the same row is 13px in a panel and 15px in a picker.
      The sidebar's link measured 250×38 before and after: 8px of padding, an 8px gap, a 6px radius, and
      every child at the same x.
- [x] Session rows: `web/src/shell/sessions.tsx:1093–1115` (`SessionRow`),
      `web/src/shell/home.tsx:36–52, 119–125`, `web/src/shell/sessions-status.tsx:69–106` (keep
      the two-tap touch submenu). The three draw one content row: `session-parts.tsx`'s
      `SessionRowContent` is `ItemContent` over `ItemTitle` and `ItemDescription`, so the sidebar's
      link, the home page's link and the status menu's rows cannot drift apart. The sidebar's row is
      `Item asChild` over its `<a>`; its own wrapper keeps the `raised` fill and the absolutely
      placed actions trigger, because the fill spans the actions and the anchor does not. The home
      link is `Item asChild` with only its `hover:bg-raised/50` left. The status menu's rows stay
      `DropdownMenuItem` / `DropdownMenuSubTrigger`: `Item` supplies no container there, only the
      parts, and `ROW` keeps its `px-2 py-1.5` because the item's own base holds the gap, the
      `data-[highlighted]` fill and the open look. One gap for all three now, 8px: the same session
      row was 12px in the home list and in the status menu and 8px in the sidebar, so it cost the
      home row 4px before its column (432 → 428 at 1280, the column 589.14 → 601.14 wide, the marks
      4px further right, the time unmoved on the right edge) and the status row 4px (the column
      48 → 44, 200.44 → 212.44 wide) at the same 53.5 and 49.5 tall. The time stays a bare span: it
      is a readout at the row's end, not a description.
- [x] Folder rows: `web/src/shell/folder-picker.tsx:289–303, 364–394` (keep double-click). The
      star beside a favourite is a `Button` already. Both rows are `Item` at `sm`: a directory is
      `Item asChild` over its `<button>` and keeps its click and its double-click, and a favourite or
      recent folder is the `Item` `div` holding the star and the label's own button. The two were
      already the same row — `rounded-control`, `px-2 py-1.5`, `gap-2`, 15px — so nothing moved: a
      directory 540×34.5, a sidebar folder 161×34.5, in the same places. The row's own focus ring can
      never show, since the `div` is not focusable and its two buttons are, so the label button carries
      the theme's ring where it had the browser's outline; the star, a `Button`, already had it.
- [x] File tree rows: `extensions/git-history/file-tree.tsx:60–101`. The row is the indent
      (`paddingLeft` from the depth), and the folder row's name is not `flex-1`. Both rows are
      `Item asChild` at `sm`, keeping their `py-0.5`, their 4px and 6px gaps and their square
      corners: the primitive's `px-2` is the 8px the rows already had on the right, and the depth
      stays the inline `paddingLeft` that overrides its left. Unmoved: a folder row 239×22 at 12px
      with 6, 16 and 26 of indent, a file row 239×22 with 32 and 52, both 8px from the right edge.
      The browser's outline became the theme's ring, drawn inset because the row is the full width
      of the column it scrolls in.
- [x] Every row that is a link takes `asChild` over the `a` and keeps its plain-click guard, so
      Cmd-click and open-in-new-tab still work: the session row's link
      (`web/src/shell/sessions.tsx:277`), a home row's link (`web/src/shell/home.tsx:38`), and the
      subagent links (`extensions/subagents/web.tsx:102`, `:159`, `:273`). The two core links are in,
      with their rows: each is still the `<a>` itself, holding its `href` and `isPlainClick`, and a
      Cmd-click, a middle click or a Shift-click returns without `preventDefault`, so the browser
      opens the tab it was asked for. The three subagent links are the same `<a>`s. The chip keeps
      the `Badge asChild` [Badge](#25-badge-installed-reduced-to-one-look) gave it: it is a chip,
      36px tall in a frame that holds a dot, a name, a model and a meter, not a row that lays out a
      title and its actions. The back link and the agent row are `Item asChild` over their links.
- [x] Queue rows: `web/src/composer/queued.tsx:53–136`. The card is `Item asChild` over its `<li>` —
      `rounded-card`, the `raised` fill, its frame, the stripe's `pl-3` and `pr-1` are the caller's —
      and the two boxes inside it were already the primitive's: the column is `ItemContent` and the
      edit/remove pair is `ItemActions`. The disclosure `Button`, the stripe and the line clamp stay.
      Unmoved on a throwaway page that held the old markup under the new: 1216×78.5 and 1216×56.5,
      `6px 4px 6px 12px`, a 6px gap, 10px corners, the stripe 3px at the left edge and the actions at
      the right one. The queue itself was not filled, so the card was measured outside the composer.
- [x] Settings rows: `web/src/shell/settings-content.tsx:133–139`. **Stays custom.** A key and its value
      are a readout, not a row of a list: 334×18 with no padding, no corner and no fill, the label and
      the value on one baseline at either end. `Item` would make it a 34px box, centre what is aligned
      on the baseline, and give it a focus ring nothing can reach, so the two spans it is stay two spans.

Extension rows: five rows, each keeping its family's fill, height and padding, and taking the
primitive's base and parts.

- [x] File tree: `extensions/files/panel.tsx:104–115`. `Item asChild` at `sm` over its `<button>`:
      573×30.5, `8px` of padding on the left as on the right, 4px of vertical padding, a 6px gap and
      the 6px radius, all unmoved, and 364×30.5 at 390. The depth is still the inline `paddingLeft`
      (8px at the root, 20px one level in), and the browser's outline is the theme's ring, drawn
      inset.
- [x] Back link and agent rows: `extensions/subagents/web.tsx:158–170, 271–287`. Both are `Item
      asChild` over their `<a>`, keeping the `href`, the `isPlainClick` guard, the `title` and the
      `aria-current`. Unmoved: the back link 980×36, 6px of margin each side, one 1px frame and a
      6px radius, its 13px line centred 8.25px down — the primitive's 8px of vertical padding sits
      inside a height `h-9` already fixes; the agent row 250×32 (`max-lg:h-11`), an 8px inset, a 6px
      gap, the same `raised` fill on the open one and the same working and idle colours, now on
      `ItemTitle`. At 390 they are 362×40 (`max-[760px]:h-10`) and 360×44.
- [x] Model cards: `extensions/subagents/profile-models.tsx:96–101`. **The card stays a card**: a
      334×54 frame at `rounded-card`, `4px 8px` of padding, and a column of a title row and a mono
      model line. Its title row takes the parts — `ItemContent`, `ItemTitle` at `text-interface` and
      `ItemActions` — and keeps its own `justify-between gap-2`, and the `items-start` it takes when
      the description is shown, which `Item`'s centred row and truncating description would undo.
      Unmoved: the title row 316×24, an 8px gap, the name at 15px ink, Change 56×24 at the right
      edge.
- [x] History row: `extensions/git-history/web.tsx:434–450`. `Item asChild` over the `Button` Phase 1
      left as the row, so the base layout, the 6px radius and the ring are the primitive's and the
      `gap-2` the caller restated is gone. Unmoved: the row 975×51.75 in its 52.75 `li` at 1280 and
      372×51.75 at 390, `8px 12px` of padding, an 8px gap, square corners, the inset ring and the
      15px text. The content stays three spans, because a button element takes phrasing content
      only: the call [Separator](#24-separator-new) made for the timeline rule, and those spans
      already say the parts' classes.
- [x] Files without a diff: `extensions/git-history/preview.tsx:222–231`. `Item asChild` over its
      `<li>`, square because the row is the rule between two files — a 6px radius would curve the
      top border — with the path as `ItemContent` and the two trailing readouts left bare, since
      they are readouts and not controls. The row is inert, so the primitive's ring never shows. No
      commit in this folder's history carries a file the patch leaves out, so the row was measured
      as markup under the old one: 35px tall, `8px 12px`, an 8px gap, a 1px top rule, the path 563
      wide and the two readouts at 583 and 627, either way.

A sweep of `extensions/` for the other rows of the same shape — a mark or an icon, a title, and
something at the end — found these seven. Each is judged by what its family already is: a row of a
popover or of a list takes `Item` where its geometry survives, and a row that is a card, a form line
or a drag handle keeps its own box.

- [x] MCP servers: `extensions/mcp/web.tsx:107–128`. `Item` at the `h-11` the row already had, so
      its vertical padding is 0: the column is `ItemContent` over `ItemTitle` at the popover's 12px,
      and the spinner and the switch are `ItemActions` with the 8px gap the row gave them. The
      extension is off on this machine and `mcp.json` holds no server, so the row was measured as
      markup under the old one: 44px tall, `0 8px`, an 8px gap, the column 220×36 with its two 18px
      lines at 4 and 22, the switch 36 wide at the row's end — either way.
- [x] MCP servers in settings: `extensions/mcp/details.tsx:81–111`. **Stays custom.** A server's name,
      target and status over a switch, in the settings column's own `gap-2`, with no frame and no
      hover: 59px tall at no padding. `Item` would make it 72, indent the name 8px from the heading
      and the alerts above it, narrow its column 286 → 274 and tighten the 12px gap to 8, for a row
      nothing else in that column shares.
- [x] Warming sessions: `extensions/keep-warm/web.tsx:139–180`. **Stays custom.** The row is 230×24
      with no padding at all — the popover's own 12px is its inset — and its 12px mono name, the
      time and the 24px × sit on one line under the "Warming" heading. `Item` at `md` would make it
      40 and start the name 8px right of that heading.
- [x] Tags: `extensions/tags/details.tsx:140–205`. **Stays custom.** The row is 646×28 at `2px 0`: a
      12px dot, the name, the count of sessions that carry it, and two 24px targets, so its height
      is the targets' plus 4. `Item` at `sm` would make it 36 and indent the dot 8px from the name
      field and the swatches above it; at `md`, 40.
- [x] Provider cards: `extensions/usage-limits/web.tsx:166–180`. **Stays custom.** It is a card, not
      a row: 247×128 and 247×208, a 1px frame at an 8px radius with 8px of padding, a heading and
      one meter per limit inside it. Nothing in it is a title with actions at its end.
- [x] To-dos: `extensions/notes/todos.tsx:357–395`. **Stays custom.** The row is 558×32 at `4px 8px`
      with `items-start`, holding a 24px grip, a 16px checkbox, the title's own button and a 24px
      bin. `Item`'s `py-2` would make it 40, its centred row would drop the grip and the checkbox
      beside a title that wraps onto two lines — at 390 such a title is 45px tall in a 53px row,
      with the grip 4px from its top and the checkbox 7, where centring would put them at 19 — and
      its ring cannot reach a row that is not focusable.
- [x] Working agents: `extensions/subagents/web.tsx:394–412`. The status bar's submenu: a working
      mark and the agent's name, inside a `DropdownMenuItem`. The container stays the menu item — the
      row is a menu's, and [Item](#39-item-new) supplies no container there — and only the name takes
      `ItemTitle`, so the row 198×31.5 at `6px 8px` and its 13px ink name are what they were.

### 3.10 Kbd (new)

Nothing rendered a keycap before this.

- [x] Add `components/ui/kbd.tsx`, with `Kbd`, `KbdGroup` and [Tooltip](#12-tooltip)'s `keys` slot as
      its first callers. A cap is the theme's 12px mono in `text-muted` on `bg-ink/20` — the text
      colour at a fifth, so one look reads as a key on the canvas, inside the raised tooltip and
      inline in text, and no role was added for it. `h-5 min-w-5 px-1.5 rounded-control`: the 6px
      radius the theme gives a block that is not a card, as [Alert](#37-alert-new) took it, because a
      4px `rounded` would be a second radius the theme does not name. `KbdGroup` is one row with a
      4px gap, for a chord; the hotkeys prefix is the caller that shows one. Measured inside a
      tooltip: a cap 48×20 for `Enter`, and the Send tooltip 102.9×30 where the label alone is 28
      tall — the row is 2px taller than a 12px line and the label does not move.
- [x] `web/src/composer/composer.tsx:777–780` — Send, `Enter`, on the hint that already said
      "Send" and on the mode's own label while a run is going, since `Enter` sends in whichever mode
      is chosen. The key is the handler's: `:696–702` submits on `Enter` without Shift on a fine
      pointer. Nothing else in the composer has a key to show. The send-mode trigger and Stop are
      click handlers, and **no handler stops a run on `Escape`**: the three Escape handlers close
      search (`web/src/shell/sessions.tsx:1155`), give the conversation back from a full-screen panel
      (`web/src/shell/panels.tsx:235`) and dismiss the slash list (`composer.tsx:633`). So Stop shows
      no key, and the `Esc` this plan expected for it is wrong until the shell binds one.
- [x] `extensions/hotkeys/web.tsx:96–108` — the armed prefix's hint, the extension's one place that
      names a key: the prefix is split on `+` and drawn as a `KbdGroup`, so the person reads the caps
      they pressed instead of the string `meta+a`. A modifier written twice in a hand-made keymap is
      drawn once. Measured: 320×46 where the label alone is 260.5×28, because 242.5 of label plus 8
      of gap plus 64.8 of caps is wider than the 302 a `max-w-xs` tooltip holds — the label wraps
      onto two lines and the caps end the second one.
- [ ] The bindings in `extensions/hotkeys` inside the hints of the core controls they run: New
      session, the folder picker, search, rename, and the two session arrows. **Left undone on
      purpose.** Nothing in `web/src/sdk` lets an extension name a key for a shell command:
      `commands.ts` holds a fixed `ShellCommand` union with `useShellCommand` (the shell's own
      handler) and `runCommand` (an extension's way to call one), the shell's buttons call their
      handlers directly, and no registry exists that the core could read a key from. A contract —
      the extension states `session.new: "prefix+c"` and the core's hint asks for it — is a new
      cross-cutting mechanism, so it is a follow-up: [4.2](#42-repeated-code-goes-to-one-place).

### 3.11 Field and Label (new)

Explicit labels instead of placeholders, `aria-invalid` and error text tied to the control.

- [x] Add `components/ui/field.tsx` and `components/ui/label.tsx`. `Label` is Radix's (which refuses
      to select its text on a second click) at `text-meta` in `text-muted`, the size every label here
      was already drawn at. `Field` is a `div` of `flex`, `orientation="vertical"` for a label over its
      control (`gap-1`) or `"horizontal"` for a checkbox beside its label (`gap-2`);
      `FieldDescription` is the hint's `text-meta text-muted`, `FieldError` is `Alert`. **No context
      and no `id` on `Field`**: a field here holds one control, so the caller writes the `id` on the
      control, `htmlFor` on the label, the `id` on the hint or the error and the `aria-describedby` on
      the control. A `Field` that wired it would have to reach into its children to find the control,
      which is what context is for and what eight call sites do not pay for. `peer-disabled:opacity-50`
      was on `Label` and applied nowhere: no control carries `peer`. It went in `737a2e7`, so the
      dimming is not waiting for a caller that would have to opt in twice.
- [x] `web/src/composer/composer.tsx:586` — `aria-label="Message"`. The field stays the hand-written
      textarea under [Kept custom](#kept-custom), so a `sr-only` label would add a node to the card
      and say the same word. Unmoved: `289,633.5,974,45`.
- [x] `web/src/shell/folder-picker.tsx:335` — "Show hidden". The `<label>` wrapped over the `Checkbox`
      is a horizontal `Field` whose `Label` names the box by `htmlFor`: unmoved, 273×18 with the box
      at `273,681.8` and the text at 297, at 1280 and at 390. A click on the text still toggles it
      (`aria-checked` false → true → false) and focuses the box; the 8px of gap between box and text
      is no longer a click target, as it already was not on the three sites
      [Checkbox](#23-checkbox-new) migrated.
- [x] `extensions/bash-timeout/details.tsx:113` — the limit, in a vertical `Field` 193.8 wide, and its
      hint a `FieldDescription` the field names in `aria-describedby`. Unmoved: the label's line box
      `317,252,193.8,18`, the field `317,274`, the hint `317,314,646`. The label's colour changed; see
      the note under the last box.
- [x] `extensions/dictation/details.tsx:239` — the idle minutes, the same shape, unmoved at
      `317,411` (label), `433` (field) and `473` (hint); its label's colour moved with bash-timeout's.
- [x] `extensions/push/web.tsx:152` — the contact field, a vertical `Field`: the same `flex flex-col
      gap-1` the wrapper `<label>` had, so nothing moves. Read rather than opened: a dev server has no
      service worker, so the section shows its "blocked" line and the field is not mounted.
- [x] `extensions/git-worktree/web.tsx:233` — "New worktree", a horizontal `Field` beside the name
      field, which keeps its `aria-label` and its existing `aria-describedby`. The row is the old
      label's rect to the tenth of a pixel (`273,639.5,102.1,18`), and a click on the text ticks the
      box and puts the caret in the name field, as the wrapped label did.
- [x] `extensions/git-history/web.tsx:171` — the reword form. Two vertical `Field`s, and the error is a
      `FieldError` with `id="reword-error"` that both controls name while it shows, marking
      themselves `aria-invalid` beside it. The form is 6.5px shorter (331 → 324.5) and each label's
      text 4px higher: the old `block` label inherited the body's 22.5px line and only its `span` was
      `text-meta`, so `Label` now gives it the 18px line every other form label has, and the two
      controls sit 0.5 and 1px higher. The label-to-control gap is the theme's 4px on both fields.
- [x] `extensions/notes/panel.tsx:275` — `aria-label="Notes"` on the editor, which fills the panel and
      has no visible label; unmoved at 581×649.5 at 1280 and 372×733.5 at 390.

The three labels that were `text-faint` — bash-timeout's, dictation's and push's — are `text-muted`
now, one palette step (`subtext0` → `subtext1`), because a field's label was drawn lighter than the
hint under it, while the other three forms in this step labelled in `muted`. Nothing else moved on
those rows.

### 3.12 Breadcrumb (new)

- [x] Add `components/ui/breadcrumb.tsx`. `Breadcrumb` is the `nav aria-label="Breadcrumb"` and
      nothing else: the box around the trail belongs to the caller. `BreadcrumbList` is an `ol` on one
      line — shadcn's `flex-wrap` and `break-words` are gone, because a path here is read on one line
      and the box around it scrolls — with `BreadcrumbItem` an `li` that does not shrink.
      `BreadcrumbLink` is `text-muted hover:text-ink` and the theme's accent ring, `asChild` over a
      button; `BreadcrumbPage` is `text-ink font-medium` with `aria-current="page"` and no role: it is
      where the person is, not a link that cannot be followed. `BreadcrumbSeparator` is a hidden `li`
      holding `›` in `text-faint`, the glyph the picker drew itself. No `BreadcrumbEllipsis`: the picker
      scrolls a long path, it never folds it.
- [x] `web/src/shell/folder-picker.tsx:226–256` — the path. The crumbs are `BreadcrumbLink asChild`
      over the buttons they already were, click handler and all, and the current folder is the
      `BreadcrumbPage`. The `div` that was the scroll box is the `nav`, so `rounded-control`,
      `bg-sunken`, `text-meta`, `px-2 py-1.5`, `font-mono` and `overflow-x-auto` are on it, and the
      `gap-1` between crumbs moved to the list. Unmoved at 1280×800: `317,143.5,690,30`; at 390×844:
      `60,62.5,314,30`. Each gap landed where it was: `Users` at 325, the mark at 365, `vantuh` at
      376.2, `projects` at 434.61, on to the last mark at 1056.3 and its name at 1067.5. An
      eleven-crumb trail (`/Users/…/data/worktrees/pi-durable-agent/hotkeys/web/src`) is 780 wide
      inside those same 690 and 314 at `scrollLeft` 0, as before: the picker still does not scroll
      itself to the end, and a desktop scrollbar still takes its 15px (bar 45 tall where a phone's
      overlay scrollbars leave it 30). An empty trail, at `/`, is `317,152.5,690,12` in both.

Two differences, both intended by the step. The crumbs draw the theme's 2px accent ring where they
drew Chromium's own 1px `auto` outline, in the browser's blue rather than the theme's. And the current crumb is no
control any more: it was a button whose click navigated to the folder already on screen, so its tab
stop did nothing; it is a span now, and activating a crumb with the keyboard leaves focus on the
dialog (`role="dialog"`, `tabindex="-1"`) instead of on the now-current crumb, one Tab away from
Up. The rest of the order is unchanged: Up, then the crumbs, then Home and Computer.

The crumb is still a `<button>`, handed to `BreadcrumbLink` through `asChild`, so the grep above still
names it: a crumb navigates inside the dialog rather than to an `href`, and the primitive supplies
the look, the hover and the ring the button used to write itself.

### 3.13 Table (new)

- [x] Add `components/ui/table.tsx`. `Table` is the frame and the table together: the overflow box with the
      card's radius and an `edge-soft` border, and `w-full border-collapse` at `text-interface` inside it, as
      the Markdown map drew both. `TableHead` is the header cell — `bg-panel`, `text-ink`, `font-semibold`,
      `px-3 py-1.5`, `border-b` in `edge-soft` — and `TableCell` the body cell, the same box `align-top`.
      `TableHeader`, `TableBody` and `TableRow` carry no look: the rule between rows is each cell's bottom
      border, because a collapsed table draws a border on the row in the same place and stretches it across
      the width where a row has fewer cells. No `TableFooter` or `TableCaption`: nothing holds a footer or a
      caption.
- [x] `web/src/ui/markdown.tsx:204–216` — the map, every element GFM gives a table. One look changed, and it
      is a fix: GFM states a column's alignment as an inline `text-align`, and the old `th` took only
      `children`, so a `:---:` or `---:` column was left-aligned with the rest. The style is handed through
      now, and an aligned column is aligned — the only difference on a throwaway page measured at 1280×800 and
      390×844, where the columns' own widths follow it. Unmoved: the frame's 1246×151.5 at 1280 and 356 wide at
      390, the 6px/12px cell padding, the header's `panel` fill at 600 weight, the 15px text, the last row's
      border sitting under the frame, and the sideways scroll at 390 (356 visible of 473) with the page itself
      staying at 390. The four tables in session 59543's transcript read as they did, and
      `test/markdown-table.test.ts` fails on the old map. The sweep for `<table>` in `web/src` and
      `extensions/` found no other site.

### 3.14 Card (only where it fits)

The bordered boxes differ in layout; adopt `Card` only where the frame, header, and body really
match, never to force one look.

- [x] Every candidate judged, and the boxes of the same frame found by grepping `rounded-card` beside
      a border and a background: **no `Card` is added**. Twelve class strings wear the radius (10px,
      `rounded-card`) and the border (1px `edge-soft`), and the fill under them splits the hosts into
      three families that share no header: seven shell regions over `bg-canvas`, three content boxes over
      `bg-panel`, two code surfaces over `bg-sunken`. Inside each family the header/body split matches
      nothing twice — three of the seven regions have a header, in two different rows, and one of the
      three boxes has one. Measured at 1280×800 and 390×844: rendered values where the box was on
      screen, the class string where its state cannot be produced read-only (a compaction summary, a
      quote, a review's message, a provider's limits). The repeat goes to
      [4.2](#42-repeated-code-goes-to-one-place); the frame already reaches every site through the
      theme's `rounded-card`, `border-edge-soft` and `bg-*` names, so a primitive adds no reach.

**Frames with the radius, the border, and a `canvas` fill** — the shell's regions, one per screen
part. Measured at 1280×800: the sidebar 264×744, home 992×744, the transcript 992×561 (374×601 at
390×844, the same 8px inset, radius and roles), the status bar 1264×32. The drawer, the covered panel
and a page are read from their class string: no panel was opened for this step.

| Box                                            | Radius | Border          | Fill     | Padding | Header                                                                                       | Body                                                                           |
| ---------------------------------------------- | ------ | --------------- | -------- | ------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `shell/sessions.tsx:991` sidebar               | 10     | 1px `edge-soft` | `canvas` | 0       | its own rows, and the folder bar's folded bottom edge                                        | the session list; 264 wide, 38 folded                                          |
| `shell/panels.tsx:191` drawer                  | 10     | 1px `edge-soft` | `canvas` | 0       | 47px `justify-between border-b px-3 py-2.5`: title, close                                    | the extension's own body                                                       |
| `shell/panels.tsx:195` covered panel           | 10     | 1px `edge-soft` | `canvas` | 0       | the same 47px row, over `animate-drop-in`                                                    | the same body, in the conversation's place                                     |
| `shell/pages.tsx:111` page                     | 10     | 1px `edge-soft` | `canvas` | 0       | the page's own                                                                               | the page, `absolute inset-0`                                                   |
| `shell/home.tsx:88` home                       | 10     | 1px `edge-soft` | `canvas` | 0       | 47px `justify-between gap-3 border-b px-3 py-2.5`: “Home”, “New session”                     | grouped session rows, 992×744 at 1280                                          |
| `transcript/transcript.tsx:558` the transcript | 10     | 1px `edge-soft` | `canvas` | 0       | 45px `min-h-[45px] justify-between gap-3 border-b px-3 py-0.5`: a two-line title, then tools | the answers, and the composer card under them; 992×561 at 1280, 374×601 at 390 |
| `shell/status-bar.tsx:58` status bar           | 10     | 1px `edge-soft` | `canvas` | 0 12    | none: a 32px `grid-cols-[1fr_auto_1fr]` of readouts                                          | —                                                                              |

**Frames with the radius, the border, and a `panel` fill** — the three boxes the plan's candidates
name. The agent card was measured where a session holds one (736×38 folded, 340 wide at 390); the
compaction summary and the quote are read from their class string, since neither state is reached
without writing a message or running a compaction.

| Box                                                | Radius | Border          | Fill    | Padding | Header                                                                                                                                         | Body                                                        |
| -------------------------------------------------- | ------ | --------------- | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `transcript/transcript.tsx:333` compaction summary | 10     | 1px `edge-soft` | `panel` | 12, 10  | none                                                                                                                                           | Markdown                                                    |
| `transcript/agent-message.tsx:27` agent card       | 10     | 1px `edge-soft` | `panel` | 0       | 36px `py-1.5 pr-1.5 pl-3`, 12px: chevron, bot, name, one-line preview, and the open-session link as its action, beside a 3px `bg-agent` stripe | `px-3 pb-2.5`: 0/12/10/12, 15px prose, folded by the header |
| `ui/quote.tsx:19` quote                            | 10     | 1px `edge-soft` | `panel` | 8, 4, 6 | none: one row of quote mark, scrolling text, and remove                                                                                        | —                                                           |

**The same radius and border with another job**, so neither family above can take them: two code
surfaces over `bg-sunken` (`ui/markdown.tsx:90`, `ui/diff.tsx:299`), each with a 32px `h-8 … border-b`
header — a language and Copy, a path and its counts — which this step keeps as they are. Two frames
with no fill at all: the tool fold (`transcript/activity.tsx:392`, 38px closed, the fill left to its
rows) and the subagent profile card
(`extensions/subagents/profile-models.tsx:95`: name and actions, then the description, `px-2.5 py-2`).
And four with a different border or fill: the queued message (`composer/queued.tsx:71`, `edge` over
`raised`), the composer (`composer/composer.tsx:507`, `edge` over `sunken`, `p-2`, and
`focus-within:border-accent`), the flavour card (`shell/appearance-dialog.tsx:89`, `edge-soft` over
`raised`, `p-2`), and a provider's card (`extensions/usage-limits/web.tsx:169`, `rounded-lg` over no
fill, `raised` only for the reader).

**Why not one `Card`.** A primitive is the frame plus the parts every host repeats. Here the fill is
the box's own job, so a base can hold only one of the three — `bg-canvas` would make `Card` the
shell's seven regions by another name, whose positioning, drag, fold and leave animation stay with the
caller, and `bg-panel` would hold three boxes of which one has a header. The header it would export
matches nothing twice either: the agent card's is a 36px collapsible trigger with no rule and an
action in its row, the compaction summary and the quote have none, and the regions' three are the 47px
row in two places (`home.tsx:89`, `panels.tsx:320` — the second without the `gap-3`) and a 45px
two-line row in the third (`transcript.tsx:559`). Both halves are the one look this step is told not
to force.

**The plan's five candidates.** The compaction summary, the agent card, and the quote are the three
boxes above, untouched. `extensions/git-history/web.tsx:780` was the review's `<pre>` — the code block
the plan keeps as it is, and one that wears no border at all: it is the `bg-panel rounded-card p-3`
block at `:790` now, a code surface without the `sunken` fill. `extensions/git-worktree/web.tsx:153`
was the review dialog's error notice, a `rounded-lg` red wash rather than a box: [Alert](#37-alert-new)
took it in Phase 3, and it is `<Alert className="mx-3 mb-1">` now. The code block, the diff, the user
bubble and attachments stay as they are.

Phase 3 ends here. The one box still open is [Kbd](#310-kbd-new)'s key registry, which is a repeat of
the core's own hints and waits in [4.2](#42-repeated-code-goes-to-one-place), as it says itself.

## Phase 4: design-system audit

Starts only after every Phase 3 box is ticked. Its aim: a change to the theme — a radius, a colour,
a base spacing step, a font size — reaches every screen by itself, with no call site to edit. Every
finding is fixed in this phase, not just listed.

### 4.1 Every class comes from the theme

- [ ] Audit every `className` and `cn(...)` in `web/src` and `extensions/` for values that bypass
      the theme: arbitrary values (`rounded-[4px]`, `px-[7px]`, `h-[30px]`, `text-[11px]`,
      `gap-[3px]`, `shadow-[…]`), raw lengths in inline `style` that are not computed geometry,
      Tailwind defaults where the theme has its own name (`rounded` / `rounded-md` beside
      `rounded-control`, `text-xs` beside `text-meta`), and any colour that is not a role.
- [ ] Fix each finding: use the theme's token, or add the missing token to the theme first
      (`styles.css`, and `catppuccin.css` for a colour), then use it. A value that must stay
      literal (measured geometry, a computed width) gets a one-line reason beside it.
- [ ] One focus treatment: every focusable primitive draws the theme's ring. Known gaps:
      `ToggleGroupItem` shows the browser's own outline, the flavour cards use `outline-ink`.
- [ ] Teach `cn` (`web/src/lib/utils.ts`) every theme scale it does not know yet, so a caller's
      token always wins over a primitive's base.

### 4.2 Repeated code goes to one place

- [ ] Audit for repetition across `web/src` and `extensions/`: the same class string or class
      fragment in several files, the same small function (formatting a time, a path, a percentage,
      a count; picking a tone; building a class), the same wrapper component written twice.
- [ ] Move each repeat to the place that owns it: a primitive's variant or size, a component in
      `web/src/ui/`, a helper in `web/src/lib/`, or an extension's own `refs.ts`. Extensions still
      never import each other (AGENTS.md); a helper two extensions need goes to the core only if
      it is not about either of them.
- [ ] Known repeats from Phase 3: `CommandEmpty` in `ui/command.tsx` restates `Empty`'s look; the
      browser panel's loading sentence ("Starting the browser…") borrows `Empty` for a state that
      is not empty.
- [ ] The box frame, counted by [3.14](#314-card-only-where-it-fits): `rounded-card` + `1px edge-soft` + `border` in twelve class strings — seven panes over `bg-canvas` (`shell/sessions.tsx:991`,
      `shell/panels.tsx:191`, `:195`, `shell/pages.tsx:111`, `shell/home.tsx:88`,
      `transcript/transcript.tsx:558`, `shell/status-bar.tsx:58`), three boxes over `bg-panel`
      (`transcript/transcript.tsx:333`, `transcript/agent-message.tsx:27`, `ui/quote.tsx:19`), two
      code surfaces over `bg-sunken` (`ui/markdown.tsx:90`, `ui/diff.tsx:299`) — and two frames with no
      fill (`transcript/activity.tsx:392`, `extensions/subagents/profile-models.tsx:95`). The pane
      header `flex items-center justify-between … border-b px-3 py-2.5` repeats in two
      (`shell/home.tsx:89`, `shell/panels.tsx:320`). `Card` does not fit here, so the audit settles the
      repeat instead: one pane primitive for the seven regions if their three header shapes can be
      one, or the frame left to the theme's three names, and the pane header's two copies folded into
      one. `transcript/transcript.tsx:558` also states `rounded-card` twice in one string, which the
      fold must not copy.
- [ ] Delete the copies; no re-export shims.
- [ ] A key an extension names for a shell command, so the core's own hints can show it — the
      follow-up [Kbd](#310-kbd-new) left open. `web/src/sdk/commands.ts` holds the command names and
      their handlers, not what runs them: a registration beside `useShellCommand`, where the keymap's
      owner states `session.new: "prefix+c"`, and a reader the core's `Hint` uses, which draws a
      `Kbd` and nothing else. A contract rather than a repeat, listed here because it belongs with the
      sdk's other gaps and not to the step that found it.

### 4.3 The rule, written down

- [ ] Extend the colour rule in `AGENTS.md` (and `docs/conventions.md`) to every design value:
      radius, spacing, font size, line height, shadow, and control height come from the theme by
      name; an arbitrary value needs a reason in the code.

### 4.4 What changed, in plain words

- [ ] When everything above is done, write a short summary for the person using the app: what
      looks and works better, what is new, and what to expect — without implementation detail.

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
