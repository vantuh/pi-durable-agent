# Theme

Catppuccin, all four flavours, in one file: `web/src/styles/catppuccin.css`. Nothing else in the
app holds a colour.

**No colour is invented, ever.** Not a hex, not `rgb()`, not `oklch()`, not a Tailwind palette
class, not an inline `style`. If a surface needs a colour the theme does not have, the answer is to
add it to the theme — a palette name in `catppuccin.css` and a role in `styles.css` — and then use
the role. Painting around the theme is the one shortcut that is never taken, including in a
throwaway page, a debug border, or a hover state.

## Three layers, three jobs

| Layer       | Lives in                      | Who names it                                          |
| ----------- | ----------------------------- | ----------------------------------------------------- |
| `--ctp-*`   | `styles/catppuccin.css`       | One block per flavour; nothing else reads it directly |
| `--role-*`  | `styles.css`                  | Components: this is a colour's job, not its name      |
| `--color-*` | `styles.css`, `@theme inline` | Tailwind utilities (`bg-canvas`) built on the roles   |

A role maps to a palette entry once, so `bg-canvas` and `var(--role-canvas)` are always the same
colour. A component says `text-muted`, not `text-subtext1`, and re-mapping the look is a one-line
change in `styles.css`.

**Tailwind's own palette is deleted** (`--color-*: initial`). `bg-neutral-900` is not a class that
exists in this project, so there is nothing to drift towards, and the build output contains no
`neutral`.

## The roles

| Role                        | Palette                       | Used for                                        |
| --------------------------- | ----------------------------- | ----------------------------------------------- |
| `canvas`                    | `base`                        | The conversation background                     |
| `panel`                     | `mantle`                      | Sidebar and drawer                              |
| `sunken`                    | `crust`                       | Code blocks, the deepest surface                |
| `raised`                    | `surface0`                    | Controls, hover, a card that must stand out     |
| `edge`                      | `surface1`                    | Borders that separate regions                   |
| `edge-soft`                 | `surface0`                    | Borders inside a region                         |
| `ink`                       | `text`                        | Body text                                       |
| `muted`                     | `subtext1`                    | Secondary text                                  |
| `faint`                     | `subtext0`                    | Metadata, timestamps                            |
| `shadow`                    | `--ctp-shadow`, per flavour   | The ink a floating surface's shadow is drawn in |
| `accent`                    | `mauve`                       | The one interactive colour: buttons, focus ring |
| `on-accent`                 | `crust`                       | Text on an accent fill                          |
| `ok` `warn` `danger` `info` | `green` `yellow` `red` `blue` | State marks, counts, tool status                |
| `tag-*`                     | eight hues, see below         | A tag's own colour, the one its owner picked    |

The `tag-*` roles (`red`, `peach`, `yellow`, `green`, `teal`, `blue`, `mauve`, `pink`) carry no
meaning of their own: an extension that lets a person colour something asks which hue and stores
that name. `extensions/tags` is the one that does, and writes the classes out in full so Tailwind
still finds them in the source. A tag is its hue as text, with no wash under the name: a row of
filled chips would shout over the title beside it.

`shadow` is the one role no Catppuccin name answers. A shadow is dark on Latte's light `base` and
darker still on Mocha's, so one palette entry cannot be right for both, and Tailwind's own shadow is
drawn in black — a colour the theme never named. Each flavour therefore names `--ctp-shadow` itself,
alpha included (crust at 45% in the three dark flavours, `text` at 14% in Latte), and the role maps
onto it like any other colour. A component uses `shadow-float`; nothing names a shadow's colour.

Text roles skip `overlay0`–`overlay2` on purpose. Measured against `canvas` they fall to 2.3–3.6 in
Latte and Frappé, which is unreadable at 12–13px; `text`, `subtext1`, and `subtext0` measure
4.4–11.3 across all four flavours. The overlays stay in the palette for borders and disabled marks.

## Switching

```html
<html data-flavour="mocha"></html>
```

- `mocha` is the default and is also the `:root` block, so a missing or unknown value renders Mocha
  instead of an unstyled page.
- Every block carries `color-scheme`, so scrollbars, form controls, and the window chrome follow.
- `main.tsx` reads `localStorage.flavour` once, before render.
- The switch is the **Appearance** modal (`web/src/shell/settings/appearance/appearance-button.tsx`), opened by the
  palette icon in the Settings footer. It shows one card per flavour: a small preview, the name,
  and six colour dots. A click calls `applyFlavour`, which sets the attribute and the key.

**The selectors are `html[data-flavour="…"]`, not `[data-flavour="…"]`.** A bare attribute selector
and `:root` have the same specificity, so with a bare selector the winner is decided by rule order
in the built file, which Tailwind reorders (`data-flavour="latte"` left Mocha's colours in place). The
`html` prefix settles it by specificity, not by order.

**Previews.** An element with `data-preview="<flavour>"` gets that flavour's `--ctp-*` (the same
blocks in `catppuccin.css`) and its own `--role-*` (the `:root` block in `styles.css`, which lists
`[data-preview]` too). The roles must be repeated: a custom property is resolved where it is
declared, so an element would otherwise show the roles of `<html>`. Inside it, use the normal
classes (`bg-canvas`, `bg-accent`). The Appearance cards do this.

## Adding a flavour

Copy a block, keep the same names — the 26 Catppuccin entries plus `shadow` — and set `color-scheme`
right. Nothing else changes: the roles are already pointing at names, not values.

## The rest of the scale

In `styles.css`, next to the roles, so no component invents its own:

- `--shadow-float` (`shadow-float`): Tailwind's `lg` geometry — `0 10px 15px -3px` and
  `0 4px 6px -4px` — in `--role-shadow`. Every surface that floats over the app wears it, so a
  popup, a tooltip, a menu and a toast cast the same shadow in every flavour;
- no radius: every corner is square, so the theme has no `--radius-*` names;
- two spacing names, for the lengths more than one component draws: `--spacing-stripe: 3px`
  (`w-stripe`: the accent mark down the side of a queued message and of a subagent's card) and
  `--spacing-header: 45px` (`min-h-header`: a pane header's floor, in the transcript and in a page).
  Every other length of the spacing scale is Tailwind's own step, `calc(var(--spacing) * n)` at 4px
  a step, and a length that belongs to one component's own drawing — a timeline mark, a rail, a
  chip's cap — stays a number in that component, with the reason beside it;
- text sizes, one name per job, smallest first: `--text-meta: 12px` (metadata, and an annotation
  inside a dense row — a duration, a file's size, a chip's model name or folder), `--text-code:
  12px` (monospace lines: code blocks, diffs, tool names and their arguments), `--text-ui: 14px`
  (the chrome: session titles, the sidebar heading, list items, tool group headings),
  `--text-interface: 15px` (the body, the conversation's prose, and the chrome that matches it),
  `--text-subheading: 16px` (a Markdown
  answer's `h2`) and `--text-heading: 18px` (its `h1`, and the extensions dialog's title);
- `--text-heading` and `--text-subheading` carry a `--text-*-line-height` (1.75rem, 1.5rem): both
  replaced one of Tailwind's own steps, which brought a line box with it, and the line box stays as
  it was. Every other name here sets a size only and inherits the line height of its line;
- `--font-sans` and `--font-mono` (`font-sans`, `font-mono`). The body and the whole interface use 15px
  system sans; code, diffs, paths, model ids and numeric metadata use JetBrains Mono. Metadata stays at
  12px. Mono chrome reads wide and heavy in Cyrillic, so the chrome stays sans.
- JetBrains Mono's variable upright and italic fonts are bundled in `web/src/fonts/` with their
  SIL Open Font License, sourced from Pi Pocket's `web/fonts/`. Vite fingerprints the assets;
  no external font service is needed.

## Check

To check a theme change, render the swatches or look at the shell: every surface in it uses a role, so a
wrong mapping is visible at once. `pnpm build` must stay free of `neutral`, `gray`, `zinc`, and
`slate`.

```bash
grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(" web/src --include=*.tsx --include=*.ts
# must print nothing: the palette lives in catppuccin.css and nowhere else
```
