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
colour. That was the point of the middle layer: a component says `text-muted`, not
`text-subtext1`, and re-mapping the look is a one-line change in `styles.css`.

**Tailwind's own palette is deleted** (`--color-*: initial`). `bg-neutral-900` is not a class that
exists in this project, so there is nothing to drift towards. A test of the deletion is that the
build output contains no `neutral`.

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
| `accent`                    | `mauve`                       | The one interactive colour: buttons, focus ring |
| `on-accent`                 | `crust`                       | Text on an accent fill                          |
| `ok` `warn` `danger` `info` | `green` `yellow` `red` `blue` | State marks, counts, tool status                |

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
- `main.tsx` reads `localStorage.flavour` once, before render. The switch itself belongs to the
  settings sheet, which is not built; until then, set the attribute or the key by hand:

```js
document.documentElement.dataset.flavour = "latte";
localStorage.setItem("flavour", "latte");
```

**The selectors are `html[data-flavour="…"]`, not `[data-flavour="…"]`.** A bare attribute selector
and `:root` have the same specificity, so with a bare selector the winner is decided by rule order
in the built file — which Tailwind reorders. This was found by setting `data-flavour="latte"` and
watching Mocha's colours stay. The `html` prefix settles it by specificity, not by order.

## Adding a flavour

Copy a block, keep the same 26 names, set `color-scheme` right. Nothing else changes: the roles are
already pointing at names, not values.

## The rest of the scale

In `styles.css`, next to the roles, so no component invents its own:

- `--radius-control: 6px`, `--radius-card: 10px` (`rounded-control`, `rounded-card`);
- `--text-meta: 12px`, `--text-interface: 13px`, `--text-prose: 15px` (`text-meta`, `text-interface`,
  `text-prose`);
- `--font-sans` and `--font-mono` (`font-sans`, `font-mono`).

## Check

The palette page that produced the screenshots for this file was temporary and is gone. To check a
theme change, render the swatches again or look at the shell: every surface in it uses a role, so a
wrong mapping is visible at once. `pnpm build` must stay free of `neutral`, `gray`, `zinc`, and
`slate`.

```bash
grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(" web/src --include=*.tsx --include=*.ts
# must print nothing: the palette lives in catppuccin.css and nowhere else
```
