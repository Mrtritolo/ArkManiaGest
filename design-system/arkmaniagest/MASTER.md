# ArkManiaGest design system: MASTER

Source of truth for every UI change in `frontend/`: the admin panel, the
player dashboard and the market. Read it before touching a page. When this
file and a page disagree, the page is wrong. When this file and the code of
the foundation disagree, fix one of them in the same change — this is a
living reference, not a record of how the UI was built.

- Candidate: **A "Ops Console"**, with the defects the two judges found
  fixed (see "Deviations from candidate A").
- Stack: React 18 + TypeScript + Vite, plain CSS custom properties in
  cascade layers, Lucide icons, react-i18next. No Tailwind classes in
  components, no CSS-in-JS, no UI-kit dependency.
- Page-specific overrides, if a page ever needs one, go in
  `design-system/arkmaniagest/pages/<page>.md` and win over this file for
  that page only. None exist today.

---

## 1. Principles

1. **Data first.** Tables, logs and numbers lead. 14px Inter with tabular
   figures for admin data; JetBrains Mono (ligatures off) for IDs, versions,
   paths, prices, SQL and logs.
2. **One accent.** Indigo is for actions, links and selection only. It never
   means a status. Status hues (success, warning, danger, info) never mean a
   category or an item quality; quality has its own tokens.
3. **Never colour alone.** Every state has a second cue: an icon, a word, a
   weight change, a bar or a fill.
4. **Flat and opaque.** 1px borders and a lightness ladder give depth. No
   glass, no blur, no glow, no gradients, no decorative pseudo-elements.
   Popovers, dialogs and toasts are opaque.
5. **Keyboard is a first-class input.** Everything operable by pointer is
   operable by keyboard, with a visible neutral focus ring that never shares
   the accent or a status hue.
6. **Motion explains, never decorates.** 120 to 240ms, transform, opacity
   and colour only, declared only under `prefers-reduced-motion: no-preference`.
7. **Tokens only.** Components and pages reference `--color-*`, `--space-*`,
   `--radius-*`, `--text-*`, `--duration-*`, `--ease-*`, `--control-*`,
   `--z-*`, `--layout-*`. Raw hex, rgba and px live in `tokens.css` only
   (1px hairlines excepted).
8. **Two densities, one token set.** Admin pages are dense; player-facing
   pages opt into the roomier scale with one class (`.ui-scope-player`).

---

## 2. Files and cascade layers

| File | Layer | Content |
|---|---|---|
| `frontend/src/styles/index.css` | (statement) | `@layer reset, base, ui, page, utilities;` plus imports of the files below. Imported FIRST in `main.tsx`. |
| `frontend/src/styles/tokens.css` | `base` | Colour tokens per theme, scales, layout, z-index, player scope, touch sizes. |
| `frontend/src/styles/base.css` | `reset` + `base` | Element defaults (reset) and global guarantees (base): 16px root, focus ring, selection, scrollbars, `[hidden]`, scroll lock, skip link, forced colours. |
| `frontend/src/styles/content.css` | `ui` | Classes for styled semantic HTML: `.ui-dl`, `.ui-code`, `.ui-log`, `.ui-details`, `.ui-fieldset`, `.ui-actionbar`, `.ui-count`, `.ui-thumb`, `.ui-nav-item`, `.ui-auth`, `.ui-bold-stable`. |
| `frontend/src/styles/utilities.css` | `utilities` | `l-*` layout and `u-*` helpers. |
| `frontend/src/components/ui/*.tsx` + co-located `*.css` | `ui` | The primitives. Each imports its own stylesheet. Barrel: `components/ui/index.ts`. |
| `PageName.module.css` next to a page | `page` | Page-only layout, tokens only. |

Those seven entries are the whole stylesheet inventory: there is no global
sheet outside `src/styles/`, and no page-level `.css` that is not a CSS
module. The three sheets of the old system (`src/index.css`,
`src/styles/legacy-aliases.css`, `pages/GameConfigPage.css`) and the
`legacy` layer they lived in were deleted when the last page group landed;
section 14 keeps the greps that hold that line.

Layer order: `reset < base < ui < page < utilities`. A later layer always
wins regardless of selector specificity or bundle order: a page module
overrides a primitive without `!important`, and a utility overrides both.
`reset` is lowest so an element default (`h1`, `a`, `body`) never has to be
fought.

Every stylesheet repeats the layer statement verbatim on its first line, so
the order holds whichever file the bundler emits first. **Copy it exactly.**
A repeat that lists a different set of names (an extra name, a different
order) re-orders the layers for the whole bundle, and the symptom — a
primitive suddenly beating the page module that customises it — does not
point back at the file that caused it. Verification is in section 14.

`@layer`, `inert` and `:has()` together need Chromium 105 / Firefox 121 /
Safari 16.4 or newer (Discord's in-app webview is Chromium).

Theme contract (`src/theme.ts`, unchanged): `data-theme="dark|light"` on
`<html>`. Dark tokens live on `:root, [data-theme="dark"]`, so a missing
attribute renders dark. Light tokens live on `[data-theme="light"]`. The
selectors are not tied to `:root`, so a subtree can opt into the other theme.
Each theme sets `color-scheme`, so native controls and scrollbars follow it.

---

## 3. Colour tokens

Measured with the WCAG 2.2 formula; translucent tokens are alpha-composited
over the plane they sit on (`A@B` = A over B). Required: text 4.5:1,
non-text (control edges, focus ring, icons, dots, bars, fills) 3:1.
Audit of 265 pairs per theme: **0 failures**. Tightest pairs: dark text 4.53
(`quality-primitive` on `surface-active`), dark non-text 3.23 (focus ring
next to the hovered accent fill); light text 4.53 (`warning` badge inside a
selected row), light non-text 3.07 (`border-strong` on `surface-active`).

### 3.1 Planes, ink, edges

| Token | Dark | Light | Use | Measured (dark / light) |
|---|---|---|---|---|
| `--color-surface-sunken` | `#0A0C0F` | `#F1F3F6` | inputs, log panel, thumb frame | plane |
| `--color-bg` | `#0D0F12` | `#F5F6F8` | page | plane |
| `--color-bg-subtle` | `#111317` | `#EEF0F3` | sidebar, read-only fields | plane |
| `--color-surface` | `#15181D` | `#FFFFFF` | cards, tables, stat tiles | plane |
| `--color-surface-raised` | `#1B1F25` | `#FFFFFF` | dialogs, toasts, popups, action bar, secondary buttons, quality chip | plane (light: same value as `surface`, see below) |
| `--color-surface-hover` | `#1F232A` | `#F0F2F5` | hover fill | plane |
| `--color-surface-active` | `#272C34` | `#E5E8ED` | neutral badge, switch track off, meter track, empty-state disc | plane |
| `--color-border` | `#2A2F37` | `#DDE1E7` | decorative edges and dividers only | decorative |
| `--color-border-strong` | `#747C89` | `#7D8490` | the edge of every control whose edge is its only affordance (input, select, secondary button, switch, segmented group) and of every floating surface that can sit on its own plane colour (Combobox popup, toast, action bar top edge) | 3.33 to 4.65 / 3.07 to 3.77 on every plane |
| `--color-text` | `#E6E8EC` | `#111418` | primary text | 11.44 to 15.96 / 15.04 to 18.47 |
| `--color-text-secondary` | `#B0B6C0` | `#434A55` | labels, table headers, descriptions | 6.88 to 9.60 / 7.28 to 8.94 |
| `--color-text-muted` | `#8F96A1` | `#5C6370` | hints, placeholders, meta, timestamps | 4.71 to 6.57 / 4.92 to 6.05 |
| `--color-overlay` | `rgba(4,5,8,.72)` | `rgba(17,20,24,.45)` | modal scrim (flat, no blur) | |

In light theme `--color-surface-raised` equals `--color-surface` (white), and
in both themes a Combobox popup inside a dialog sits on the dialog's own
plane. A floating surface is therefore never bounded by the decorative
`--color-border` hairline and a shadow alone: the Combobox popup, the toast
and the top edge of `.ui-actionbar` use `--color-border-strong` (3.48 to 4.56
dark / 3.48 to 3.77 light against bg, surface and surface-raised). Dialogs
keep the hairline: the scrim already separates them.

### 3.2 Accent and focus

| Token | Dark | Light | Use | Measured (dark / light) |
|---|---|---|---|---|
| `--color-accent` | `#737ADF` | `#4A4FD0` | solid FILL: primary button, switch on, checkbox, selection bars, `::selection`; and the EDGE of pressed and checked controls (pressed Button and IconButton, checked segment) | 3.73 to 5.20 / 5.15 to 6.32 vs planes; as an edge 3.31 to 4.27 / 4.82 to 5.46 against its own tint, 4.19 / 5.64 against a hovered pressed Button, 3.73 / 5.15 against a hovered pressed IconButton |
| `--color-accent-hover` | `#7E86EC` | `#565CDB` | primary button hover | 4.35 to 6.07 / 4.33 to 5.32 vs planes |
| `--color-accent-text` | `#A3AAFF` | `#4A4FD0` | accent INK: links, pressed/selected text and icons, accent badge | 6.52 to 9.09 / 5.15 to 6.32 on every plane |
| `--color-accent-subtle` | `rgba(115,122,223,.18)` | `rgba(74,79,208,.10)` | selection and pressed tint | accent-text on it 6.58 / 5.46 (surface), 6.94 / 4.82 (bg-subtle) |
| `--color-text-on-accent` | `#0D0F12` | `#FFFFFF` | text on the accent fill | 5.10 / 6.32 on accent, 5.95 / 5.32 on hover |
| `--color-focus-ring` | `#FFFFFF` | `#000000` | the one focus indicator | 14.04 to 19.58 / 17.10 to 21.00 on planes; 3.76 / 3.32 against the accent fill, 3.23 / 3.95 against the hovered fill |

The focus ring is **neutral** in both themes: never the accent, never a
status hue. Its OKLab distance (x100) from accent and every status colour is
at least 21.8 in dark and 42.5 in light under normal vision and deutan,
protan and tritan simulation. In dark mode no single chromatic colour clears
3:1 against both the dark planes and a light accent fill, which is why the
ring is white and the accent fill was darkened (see deviations). Rings are
drawn at `outline-offset: 2px` around any element with a solid accent fill
(a gap of plane colour always separates them) and inset only on elements
whose own fill is a plane or a tint. An inset ring is drawn inside the
element's selection mark, so focus never hides it: `-4px` on tabs and nav
items (inside the 2px accent bar), `-3px` on segments (inside the 1px checked
edge), `-2px` where there is no mark (scroll regions, sort buttons, log
panel, details summary).

### 3.3 Status

| Token | Dark | Light | Measured ink on planes (dark / light) | Ink on its tint, incl. inside a selected row |
|---|---|---|---|---|
| `--color-success` / `-subtle` | `#4ACB8B` / `rgba(74,203,139,.14)` | `#126C43` / `rgba(18,108,67,.10)` | 7.66 to 9.52 / 5.66 to 6.46 | 5.26 to 7.64 / 4.85 to 5.57 |
| `--color-warning` / `-subtle` | `#E9B14C` / `rgba(233,177,76,.14)` | `#8F5600` / `rgba(214,140,20,.16)` | 8.15 to 10.12 / 5.26 to 6.00 | 5.53 to 8.05 / 4.53 to 5.17 |
| `--color-danger` / `-subtle` | `#FF8077` / `rgba(255,128,119,.14)` | `#B82A25` / `rgba(184,42,37,.09)` | 6.46 to 8.03 / 5.42 to 6.18 | 4.62 to 6.65 / 4.66 to 5.36 |
| `--color-info` / `-subtle` | `#5DB9EE` / `rgba(93,185,238,.14)` | `#0A67A3` / `rgba(10,103,163,.09)` | 7.24 to 8.99 / 5.28 to 6.03 | 4.97 to 7.26 / 4.60 to 5.29 |

Runtime status mapping (StatusBadge): online = success + CircleCheck;
offline = neutral + CircleOff; updating, testing = info + RefreshCw;
crashed, error = danger + CircleAlert; degraded (and "update pending") =
warning + TriangleAlert; unknown = neutral + CircleHelp. Updating is info so
it never looks like Crashed or Mastercraft.

### 3.4 Item quality (ASA tiers)

| Token | Dark | Light | Text on every plane (dark / light) |
|---|---|---|---|
| `--color-quality-primitive` | `#8C939E` grey | `#3F4550` | 4.53 to 6.32 / 7.85 to 9.64 |
| `--color-quality-ramshackle` | `#86D46B` green | `#2F6A17` | 7.78 to 10.86 / 5.35 to 6.57 |
| `--color-quality-apprentice` | `#5B9BFF` blue | `#1D55B8` | 5.06 to 7.07 / 5.62 to 6.90 |
| `--color-quality-journeyman` | `#D4A8FF` purple | `#8244CA` | 7.25 to 10.11 / 4.71 to 5.79 |
| `--color-quality-mastercraft` | `#E8D34F` yellow | `#7A6400` | 9.27 to 12.93 / 4.68 to 5.75 |
| `--color-quality-ascendant` | `#3FC9C9` cyan | `#00737D` | 6.96 to 9.71 / 4.56 to 5.60 |

Each clears 4.5:1 as text on every plane, so each is also valid as a 3:1 dot
or border. Under colour-vision deficiency apprentice vs journeyman and
ramshackle vs mastercraft converge, so **the tier name is always written**
(QualityBadge does it). Quality colours are for quality only.

### 3.5 Data series

`--color-series-1..6` (dark `#3987E5 #D95926 #199E70 #C98500 #D55181 #008300`,
light `#2A78D6 #D95926 #199E70 #B27C00 #D55181 #008300`): categorical chart
marks in fixed order, at least 3:1 on `bg` and `surface`. Never for status,
never cycled, text is never set in a series colour.

### 3.6 Shadows

`--shadow-sm` (cards, tiles), `--shadow-md` (popups, action bar),
`--shadow-lg` (dialogs, toasts). Dark values are stronger; in dark mode depth
comes mostly from the plane ladder and borders.

### 3.7 Re-measuring

Any new token value, or any new stack of a tint on a plane (a badge inside
an alert, a tinted row inside a dialog), is measured before it ships. The
audit script used for this file (`contrast-final.py`, WCAG luminance, alpha
compositing with `A@B@C`, Machado 2009 CVD simulation, OKLab distance)
reads `tokens.css` directly and exits non-zero on a failure. It lived in the
design session scratchpad; see the open issue about committing it under a
tools folder.

Known constraints:
- Status tints are never stacked on the hover plane inside a selected row (a
  selected row keeps its tint on hover), and status badges never sit on
  `surface-active`. Both stacks drop below 4.5:1.
- `--color-text-muted` never sits on `accent-subtle` over `surface-raised`
  (4.39:1 dark). The highlighted Combobox option re-points
  `--color-text-muted` to `--color-text-secondary` inside itself (6.42 / 7.72),
  so a muted second line in `renderOption` stays readable.
- A pressed control never sits on `surface-active`: its accent edge against
  `accent-subtle` over `surface-active` is 2.97:1 in dark.

---

## 4. Scales

### 4.1 Type (rem on a 16px root)

| Token | px | Use |
|---|---|---|
| `--text-xs` | 12 | badges, captions, nav group labels, map IDs. Hard floor. |
| `--text-sm` | 13 | table headers, labels, hints, errors, log lines, stat meta, sm controls |
| `--text-base` | 14 | admin body, table cells, controls |
| `--text-md` | 16 | player body and controls, empty-state title |
| `--text-lg` | 18 | dialog titles, player card titles, prices |
| `--text-xl` | 20 | |
| `--text-2xl` | 24 | page title (h1), stat values |
| `--text-3xl` | 30 | player hero numbers |

Roles re-pointed by the player scope: `--text-body`, `--text-control`.
Line heights: `--leading-tight` 1.2 (titles, values), `--leading-snug` 1.35
(controls, badges, labels), `--leading-normal` 1.5 (body), `--leading-relaxed`
1.6 (logs, editors). Weights: 400 body, 500 labels and controls, 600
headings, selected and pressed. Never 700 to 900 (not loaded). Titles use
`--tracking-title` (-0.015em); body tracking is never changed. Headings use
`text-wrap: balance`. Numbers in tables, timers, prices and stat values use
`font-variant-numeric: tabular-nums` (on by default in `table`, `time`,
`data`, `output`).

**Where the size comes from.** `base.css` leaves the root at `100%`, i.e.
the user's own default (normally 16px), and every `--text-*` token is a rem
against it: never pin `html { font-size: <n>px }`, that silently rescales
the whole system and breaks browser zoom expectations. The `reset` layer
gives `body` `var(--text-body)` and `--leading-normal` as the floor; a page
root then states its own density rather than inheriting the shell's.
`.l-page` and `.ui-auth` set `font-size: var(--text-body)` and
`line-height: var(--leading-normal)` for exactly that reason; dialogs and
toasts size their own text; `.ui-scope-player` on `<body>` re-points
`--text-body` / `--text-control` from `@layer base`, so the primitives
inside it grow without a single variant prop. A page root that is neither
`.l-page` nor `.ui-auth` sets `font-size: var(--text-body)` itself.

### 4.2 Spacing (4px grid)

`--space-0-5` 2, `-1` 4, `-1-5` 6 (icon-label gap), `-2` 8, `-3` 12, `-4` 16,
`-5` 20, `-6` 24, `-8` 32, `-10` 40.
Admin: cell padding 4x12, card body 16, grid gaps 12 to 16, page padding 24
(16 below 600px). Player scope: card body 20, gaps 16 to 24, sections 40.

### 4.3 Radius

`--radius-xs` 2 (kbd, code), `--radius-sm` 4 (buttons, inputs, badges),
`--radius-md` 6 (cards, alerts, toasts, table frame), `--radius-lg` 8
(dialogs, market item cards), `--radius-full` (switch, avatar, dots).

### 4.4 Controls and targets

| Token | Admin | `.ui-scope-player` | `pointer: coarse` |
|---|---|---|---|
| `--control-sm` | 28 | 32 | 44 |
| `--control-md` | 32 | 40 | 44 |
| `--control-lg` | 40 (dialog footer) | 40 | 44 |
| `--hit-min` | 24 (WCAG 2.5.8) | 24 | 44 |

Other sizes: `--control-standalone-w` 16rem (standalone Input/Combobox),
`--switch-w/h` 36x20, `--check-size` 16, `--badge-h` 22,
`--dot-size` 8, `--meter-h` 4, avatars 24/32/56, tabs 44 tall.
Tables: `--row-h` 36 (header and single-line rows), `--row-h-2` 44
(two-line rows), `--row-line` 28 (the cell line box). Measured in Chromium
with the harness: header 36, text 36, badge 36, 28px icon-button row 36,
sm-input row 36, two-line row 44. Under a coarse pointer every table control
reaches 44px too (row checkbox label, sort button, row button, row
IconButtons, sm inputs), so the rows that hold one grow with it; the
harness figures are listed in section 7.4 (Table). Rows with text and badges
only keep 36px.

### 4.5 Motion

| Token | Value | Use |
|---|---|---|
| `--duration-fast` | 120ms | hover, colour, press scale 0.98 |
| `--duration-base` | 180ms | tabs, switch, overlay fade, chevrons |
| `--duration-slow` | 240ms | dialog and toast enter |
| `--duration-spin` | 900ms | spinner, linear |
| `--ease-enter` | `cubic-bezier(0,0,0.2,1)` | arrivals |
| `--ease-exit` | `cubic-bezier(0.4,0,1,1)` | departures |
| `--ease-standard` | `cubic-bezier(0.2,0,0,1)` | state changes |

**Motion is opt-in, and there is no safety net.** Every `@keyframes` use and
every `transition` in the bundle sits inside
`@media (prefers-reduced-motion: no-preference)`, and the two smooth
`scrollIntoView` calls read `matchMedia('(prefers-reduced-motion: reduce)')`
before asking for `behavior: 'smooth'`. `base.css` used to carry a
`* { animation-duration: 0.01ms !important }` net under
`(prefers-reduced-motion: reduce)` to tame the legacy sheet's unguarded
animations; with that sheet gone nothing needed it, so it was removed rather
than left as a comfort blanket. The consequence: **a rule that animates
outside a `no-preference` query is a bug that nothing will catch for you.**
Declare motion only inside the query, transform/opacity/colour only.

### 4.6 Stacking

`--z-base` 0, `--z-sticky` 20 (action bar, sticky headers), `--z-dropdown`
30, `--z-drawer` 40, `--z-modal` 50, `--z-toast` 60 (above dialogs),
`--z-skip` 70. No other z-index values.

The scale is small on purpose: every surface that raises itself reads one of
these tokens (Modal `--z-modal`, Toast `--z-toast`, the shell drawer
`--z-drawer`, sticky headers and `.ui-actionbar` `--z-sticky`, the skip link
`--z-skip`). The inflated values `legacy-aliases.css` used to set (11000 to
12200, to clear hand-built overlays at 1000 to 9999) went with that file;
nothing stacks outside the tokens any more.

`--z-dropdown` is currently reserved and unused: the Combobox popup sets no
`position` and no `z-index`, it renders in normal flow under the input
(`Combobox.tsx`), which is what keeps it from being clipped inside a modal
or a table cell. Its stacking is flow order, not a token. Give it
`--z-dropdown` only together with a `position`, and only if a real overlap
appears — a raised popup is a clipping bug waiting to happen.

A z-index literal in a page is a defect: it means the page built its own
overlay instead of using `Modal`. The single exception in the codebase is
`z-index: 1` on a sticky table header inside `Table`'s own scroll container,
which is a local stacking context, not a page-level surface.

### 4.7 Layout and breakpoints

Media queries cannot read custom properties, so breakpoints are literal:
**375px** minimum supported width, **600px** sm, **900px** md, **1200px** lg,
**1440px** content max width.

| Token | Value | Use |
|---|---|---|
| `--layout-sidebar-w` | 240px | sidebar at 900px and up |
| `--layout-drawer-w` | 280px | navigation drawer below 900px |
| `--layout-topbar-h` | 56px | sticky mobile top bar below 900px |
| `--layout-content-max` | 1440px | `.l-page` max width |
| `--layout-page-pad` | 24px (16px below 600px) | `.l-page` padding |
| `--layout-rail-w` | 220px | config nav rail (`.l-split--rail`) |
| `--layout-aside-w` | 360px | detail aside (`.l-split`) |
| `--modal-sm/md/lg` | 460 / 560 / 760px | dialog widths, always `min(size, 100%)` |
| `--toast-w` | 380px | toast column |
| `--popup-max-h` | 240px | Combobox list |
| `--measure-prose` / `--measure-empty` | 65ch / 38ch | long text / empty-state description |

Shell (group G1): at 900px and up a sticky 240px sidebar on
`--color-bg-subtle`; below 900px a 56px sticky top bar with brand and a menu
button (`aria-expanded`) that opens a 280px drawer with a visible close
button, a scrim, Escape, inert main content and focus returned to the menu
button (use `useDialogFocus`). The drawer is a dialog wrapping the
navigation and exists only while open: `{open && <div ref={rootRef}><div
className="scrim"/><div {...panelProps} aria-label={t('nav.menu')}><nav
aria-label={t('nav.main')}>…</nav></div></div>}`. `role="dialog"` never goes
on the `<nav>` itself (it would remove the landmark), and the desktop sidebar
never receives `panelProps`. While the top bar is sticky, set
`scroll-padding-top: calc(var(--layout-topbar-h) + var(--space-2))` on
`html` so focused controls are never hidden under it. On route change move
focus to `#main-content`. No global search, no single-key shortcuts.

---

## 5. Density

| | Admin pages | Player pages (`.ui-scope-player`) |
|---|---|---|
| Body text | 14px | 16px |
| Controls | 32px, sm 28px | 40px, sm 32px |
| Table rows | 36px / 44px two-line | same tables, 16px text |
| Card body | 16px | 20px |
| Grid gaps | 12 to 16px | 16 to 24px |
| Card titles | 14px/600 | 18px/600 |
| Prices | mono tabular | 18px mono tabular with a muted "pts" unit |

The standalone PlayerDashboard and Market pages (and nothing else) add
`ui-scope-player` to `<body>` in an effect and remove it on unmount:

```tsx
useEffect(() => {
  if (embedded) return;
  document.body.classList.add("ui-scope-player");
  return () => document.body.classList.remove("ui-scope-player");
}, [embedded]);
```

On `<body>` the scope also reaches what those pages portal there: the buy
dialog, the account-deletion confirm and toasts. Every primitive picks up the
roomier scale without a variant prop. Embedded in the admin layout the pages
keep the admin scale. The standalone root is `<main id="main-content"
tabIndex={-1} className="l-page">`, so the focus fallback of dialogs and
toasts has a target there too. Under `pointer: coarse` every control reaches
44px regardless of scope.

---

## 6. Fonts (self-hosted)

No request leaves for Google Fonts (GDPR, see `docs/COMPLIANCE.md`).

- Packages: `@fontsource-variable/inter` and
  `@fontsource-variable/jetbrains-mono` (5.3.0), added to `dependencies`.
- In `main.tsx`, before the styles import, the two default entries and
  nothing else:
  ```ts
  import "@fontsource-variable/inter";            // registers 'Inter Variable' (wght 100-900)
  import "@fontsource-variable/jetbrains-mono";   // registers 'JetBrains Mono Variable'
  ```
  Do not also import `@fontsource-variable/inter/opsz.css`: it registers the
  same `'Inter Variable'` family, so Inter would download twice. The wght
  entry is Inter's text design, which is what 12 to 24px UI text wants. If
  the optical-size axis is ever wanted, replace the first import with
  `opsz.css`; no CSS change is needed (`font-optical-sizing` is `auto` by
  default).
- No font ever comes from a CDN. The old `@import url('https://fonts.
  googleapis.com/…')` went with `src/index.css`, and
  `https://fonts.googleapis.com` (style-src) / `https://fonts.gstatic.com`
  (font-src) are no longer in the Content-Security-Policy of
  `deploy/nginx-production.conf`. Adding a font host back to either place is
  a GDPR regression, not a convenience.
- Families (tokens.css): `--font-sans: "Inter Variable", "Inter", ui-sans-serif,
  system-ui, …`; `--font-mono: "JetBrains Mono Variable", "JetBrains Mono",
  ui-monospace, "Cascadia Mono", Consolas, …`. Fontsource CSS uses
  `font-display: swap`.
- Mono text always sets `font-variant-ligatures: none` (`code`, `kbd`,
  `samp`, `pre`, `.u-mono`, `.ui-control--mono`, `.ui-log`): `->`, `!=`,
  `>=` in SQL and logs must show literally.

---

## 7. Primitives

Import everything from the barrel:

```ts
import { Button, Card, Field, Input, Table, useConfirm, useToast } from "../components/ui";
```

All primitive text comes from props (callers pass translated strings). The
few built-in strings use `t("ui.*")` / `t("common.*")` (section 12).
Class names are global with a `ui-` prefix and BEM parts; state is styled
from ARIA and data attributes (`[aria-disabled]`, `[aria-busy]`,
`[aria-pressed]`, `[aria-checked]`, `[aria-expanded]`, `[aria-current]`,
`[aria-invalid]`, `tr[data-selected]`, `[aria-selected]` on tabs and options
only). A page never restyles a primitive's internals; a missing variant is
requested from the foundation owner.

`className` always lands on the outermost element a primitive renders, so a
grid or width utility (`u-span-full`, `u-push`) behaves the same on every
control: the `<input>` itself, or the wrapper `<span>` when Input renders one
(`type="search"`, revealable password); Select's wrapper `<span>`; the
`<textarea>`; Checkbox's `<label>`; Switch's row `<span>`; Combobox's wrapper
`<div>`.

### 7.1 Actions

**Button** `variant?: 'primary'|'secondary'|'ghost'|'danger'` (default
secondary) · `size?: 'sm'|'md'` · `icon?: LucideIcon` · `loading?` ·
`loadingLabel?` · `disabled?` · `pressed?` · all native button props
(`type` defaults to `"button"`), `ref` forwarded.
`buttonClass({ variant, size })` gives the classes for an `<a>` or `<Link>`.

- `disabled` and `loading` never set the native attribute: `aria-disabled`
  plus a click guard (which also cancels implicit form submission), so focus
  is never dropped. `loading` adds `aria-busy`, swaps the icon for a spinner
  and the text for `loadingLabel` inside one grid cell (no width jump).
- `pressed` (toggle, filter chip) sets `aria-pressed`: accent tint, accent
  edge, accent ink and weight 600; a hidden bold copy keeps the width stable.
  Hovered, the fill turns to the hover plane and the accent edge stays.
- Do: one `primary` per region (repeated per-item Buy buttons excepted);
  verb + object labels ("Delete machine"); `danger` last in its row with
  `className="u-push"`, always behind `useConfirm`.
- Don't: status colours for Start/Restart (they are `secondary`; Stop is
  `danger`); dashed "Add" buttons (use `secondary size="sm" icon={Plus}`);
  text glyphs as icons; `window.confirm`.

**IconButton** `icon` · `label` (required: aria-label and title) ·
`size?: 'sm'|'md'` (default md) · `tone?: 'danger'` · `loading?` ·
`disabled?` · `pressed?` · native props (`aria-expanded`, `aria-controls`
pass through), `ref` forwarded. A `ChevronDown` rotates 180° and a
`ChevronRight` 90° when `aria-expanded="true"`. Pressed = accent tint, accent
ink **and a 1px accent edge** (the 3:1 cue; the tint alone is 1.2:1). A
toggle whose meaning flips may also swap its glyph (Input's reveal toggle
shows `EyeOff` while the password is visible).

- Do: label = verb + object ("Restart The Island"); keep unavailable row
  actions visible with `disabled`; use it for dismiss, close, reveal,
  expanders and row actions.
- Don't: bare `background:none` icon buttons; icon buttons without a label;
  `div onClick` expanders.

**CopyButton** `value` · `label` · `size?` (default sm). Icon swaps to a
check for 1.5s with a visually hidden `role="status"` "Copied"; failure
raises `toast.error(t('ui.copyFailed'))`. Goes through `utils/clipboard`.

### 7.2 Forms

**Field** `label` · `children` (exactly one Input, Select, Textarea or
Combobox) · `hint?` · `error?` · `required?` · `className?` (grid placement).
Generates the control id, renders a visible `<label htmlFor>`, links hint and
error through `aria-describedby` (error first), sets `aria-invalid` and
`aria-required`.

- Do: validate on blur; error text says cause and fix ("Enter a port between
  1 and 65535"); after a failed submit focus the first invalid control;
  character counters go in `hint`.
- Don't: placeholder-only labels; errors only in a page banner; `<label>`
  without `htmlFor`; a `<div>` pretending to be a label.

**Input** `size?: 'sm'|'md'` · `mono?` · `revealable?` (password only) ·
`className?` · native input props, `ref` forwarded. `type="search"` draws the leading search
icon. Outside a Field it needs `aria-label` (dev builds warn). Inside a Field,
a table cell or a Combobox it fills its box; standalone (toolbar search,
filter box) it takes `--control-standalone-w` (16rem) and shrinks on narrow
screens, so it never claims a whole flex row. Read-only
values render with a dashed edge on `bg-subtle`; prefer `dl.ui-dl` for pure
display.

**Select** `size?` · native select props; children are `<option>`s. Native
list, themed chevron, `color-scheme` per theme. Booleans use Switch, not a
Yes/No select.

**Textarea** `mono?` (editors: 13px/1.6, no wrap, tab-size 2, spellcheck
off) · native props. An editor that traps Tab must release it on Escape.

**Checkbox** `type?: 'checkbox'|'radio'` · `indeterminate?` ·
`description?` · `label` **or** `aria-label` (the type requires one: `label`
must be a value that always renders, so `label={cond && t('x')}` or
`label={undefined}` needs `aria-label`; dev builds also warn on an empty
name) · native props, `ref` forwarded. Native input inside its label (hit
area at least 24px, 44px on touch, in table cells too). Row selection:
`aria-label="Select {name}"`.

**Switch** `checked` · `onChange(checked)` · `label` (never empty) ·
`hideLabel?` (table cells) · `description?` · `disabled?` · `id?` ·
`className?`, `ref` forwarded to the switch button. `<button role="switch"
aria-checked>` named by a real `<label>`. For settings that apply
immediately; a Save-button form uses Checkbox.

**SegmentedControl** `label` (sr-only legend) · `options: {value,label}[]` ·
`value` · `onChange` · `size?`. Native radios in a fieldset: one tab stop,
arrow keys from the platform. Checked = tint, accent ink, weight 600 and a
1px inset accent edge (5.20 / 5.69 against the well, 4.27 / 4.94 against the
tint); the inset focus ring sits inside that edge. For 2 to 5 short,
mutually exclusive filters or modes. More options: Select.

**Combobox** `label?` (required outside a Field) · `inputValue` ·
`onInputChange` · `options` · `getKey` · `renderOption` · `onSelect` ·
`loading?` · `emptyText?` · `placeholder?` · `mono?` · `size?` · `disabled?` ·
`className?` · `inputRef?` (a prop rather than `ref`, so the option generic
survives; lets a page focus the first invalid control).
APG combobox with a listbox that renders in normal flow (never clipped by a
dialog or table; inside a table cell it pushes the row taller while open).
The popup has a `border-strong` edge; the highlighted option lifts muted
ink to secondary (section 3.7). ArrowUp/Down move, Enter selects, Escape closes the list
without closing an enclosing dialog, Tab closes. Loading and "no results"
are announced through a polite status. The page debounces with
`useDebouncedValue`, fetches with a stale-response guard and caps the list
(about 50).

### 7.3 Overlays and feedback

**Modal** `open` · `onClose` · `title` · `description?` ·
`size?: 'sm'|'md'|'lg'` · `footer?` · `dismissible?` (default true; false
while busy) · `initialFocusRef?` · `onSubmit?` · `children`. Portal on body;
background inert and unscrollable (inert is counted, so closing a lower
stacked dialog never frees the page under the top one); focus goes to
`initialFocusRef`, else the first form control that is a Tab stop, else the
panel; Tab wraps, and a radio group (SegmentedControl) counts as one stop,
so focus cannot leave a dialog that ends in one; Escape closes only the
top-most dialog;
a backdrop click closes only when press and release both hit the backdrop;
focus returns to the trigger, or to `#main-content` if the trigger is gone.
Built on `hooks/useDialogFocus`, which builds on `hooks/useModalA11y`.

- Footer: DOM order Cancel (secondary) then confirm (primary or danger).
  Right-aligned; below 600px the buttons stack full-width **in DOM order**
  (column, never column-reverse). Footer buttons are 40px.
- Form dialogs pass `onSubmit`: body and footer become one
  `<form noValidate>`, so Enter in a field and a footer
  `<Button type="submit">` both submit. Modal calls `preventDefault` and
  stops the submit event from bubbling (through the portal) into a page
  `<form>` that rendered the dialog. Never put the `<form>` in `children`
  with the submit button in `footer`: they would be different subtrees.
- Errors raised while a dialog is open render inside its body as an Alert;
  typed input is kept on failure; the dialog stays open.
- Dirty forms: `onClose` asks `useConfirm` before discarding.
- Don't: hand-built `position:fixed` overlays, z-index literals, translucent
  panels, dialogs for navigation.

**useConfirm / ConfirmProvider** `confirm({ title, description?,
confirmLabel, cancelLabel?, tone?: 'danger'|'default', confirmText? })`
resolves `true` or `false`. It replaces `window.confirm` in one line:
`if (!(await confirm({ … }))) return`. Initial focus is Cancel, or the typed
input when `confirmText` is set (Confirm stays `aria-disabled` until the
text matches exactly). Requests queue; one dialog at a time; can open from
inside a Modal. `description` renders in ConfirmProvider's tree, not the
caller's: router components (`<Link>`) work because the providers sit inside
`<BrowserRouter>`; a context the calling page provides itself does not.

- Use for every destructive action, for Stop/Restart of a running instance,
  for unsaved-change guards on in-page context switches and Discard, and
  with `confirmText` for irreversible mass actions (cluster wipe, delete all
  filtered, prune, destructive SQL, lockout-risk hardening).
- `confirmLabel` is an explicit verb ("Delete machine"), never "OK".

**useToast / ToastProvider** `toast.success(msg, opts?)`,
`toast.info(msg, opts?)`, `toast.error(msg, opts?)`, `toast.dismiss(id)`;
`opts = { title?, action?: { label, onClick } }`.

- success and info auto-dismiss after 5s; the timer pauses while the toast
  is hovered or holds focus. error persists until dismissed. Any toast with
  an `action` (Retry, Undo, Open logs) persists too, whatever its tone
  (WCAG 2.2.1: a keyboard or screen-reader user needs time to reach it);
  clicking the action also dismisses it.
- One region portaled on body, outside every inert subtree, above dialogs:
  a `role="status"` list and a `role="alert"` list, both mounted from the
  first render. A toast never takes focus; dismissing one that holds focus
  sends focus to `#main-content`.
- At most 3 shown; the rest wait in arrival order and appear when a slot
  frees. A new toast may take the slot of an OLDER one that is neither
  hovered nor focused: an auto-dismissing toast that has already rendered is
  removed, otherwise the oldest persistent one goes back to waiting. A toast
  is never dropped unseen, and the one under the pointer or focus never
  moves.
- Bottom-right 380px; full width with 16px gutters below 600px. While a
  `.ui-actionbar` exists the column is lifted above a one-row bar, so a
  focused Save is never covered. `border-strong` edge (section 3.1).
- Rule: **page-load failure = Alert, action result = toast, field problem =
  Field error.**

**Alert** `tone: 'info'|'success'|'warning'|'danger'` · `title?` ·
`children?` · `actions?` (Button sm) · `onDismiss?` · `className?`.
Persistent inline message with a 20px icon and an sr-only tone prefix
("Warning:"). Only `danger` is `role="alert"`. Use for load errors with
Retry, warnings, notes and errors inside dialogs.

**Spinner** `label?` (visible text, adds `role="status"`) · `block?`.
Without a label it is decorative: the owning control or region carries
`aria-busy`. Static under reduced motion. Refetches keep stale content
visible with an inline Spinner in the Card header; `block` is for the first
load only.

**EmptyState** `icon?` · `title` · `description?` · `action?` (at most one
secondary Button). Only after loading finished without error.

### 7.4 Structure and data display

**PageHeader** `title` · `icon?` · `description?` · `actions?`. The page's
only `<h1>`. Actions wrap under the title below 600px.

**Card** `title?` · `titleAs?: 'h2'|'h3'` · `icon?` · `actions?` ·
`footer?` · `flush?` (no body padding: Table, lists, logs) · `className?`
· `children`. With a title it is a `<section aria-labelledby>`. Static:
**never hover, lift or pointer cursor**.

**StatTile** `label` · `value` · `icon?` · `unit?` · `meta?` ·
`metaTone?: 'success'|'warning'|'danger'` · `loading?` · `href?` (whole tile
is a router Link) · `onClick?` + `pressed?` (filter toggle). Problem states
show the status colour **and** an icon **and** words ("1 crashed"). Only
link and button tiles react on hover. Layout: `.l-grid--stats`.

**Badge** `tone?: 'neutral'|'accent'|'success'|'warning'|'danger'|'info'` ·
`icon?` · `dot?` · `children` · `className?`. 22px, 12px/500, visible text,
no aria-label. A status tone always has an icon or dot plus a word. Numeric
counts use `<span className="ui-count">`.

**StatusBadge** `status: RuntimeStatus` · `label?`. Pages map raw API
strings (running, stopped, restarting, container states) to `RuntimeStatus`
in their model code; raw strings are never rendered.

**QualityBadge** `tier: 'primitive'|'ramshackle'|'apprentice'|'journeyman'|
'mastercraft'|'ascendant'`. Neutral chip, rotated-square marker and tier name
in the quality colour, sr-only "Quality:" prefix. Until the integer quality
to tier mapping is confirmed, pages show a neutral `Badge` "Q{n}".

**Meter** `value` · `max?` · `label` · `valueText?` ·
`tone?: 'accent'|'success'|'warning'|'danger'` · `kind?: 'meter'|'progress'`
· `className?`. 4px bar; the caller prints the number next to it and maps
thresholds (e.g. 60/85) to a tone.

**Avatar** `name` · `src?` · `size?: 'sm'|'md'|'lg'`. Decorative
(`aria-hidden`); the name is always rendered next to it. Grapheme-safe
initial, `?` for empty names, image errors fall back to the initial. No
brand or gradient fills.

**Tabs** `label` · `items: {id, label, icon?, count?}[]` · `value` ·
`onChange` · `children` (the active panel) · `focusablePanel?` ·
`className?`. Roving tabindex; ArrowLeft/Right/Home/End move from the
focused tab and activate. Focus follows `value`, not the key press: a parent
that refuses or defers the switch (useConfirm on a dirty form) leaves focus
on the tab that is still selected, and the new tab takes focus once `value`
changes. The panel is a Tab stop only with `focusablePanel` (APG: panels
without focusable content). Selected = text colour, weight 600
(width-stable) and a 2px accent bar; the focus ring is inset and neutral,
inside the bar. Deep links: pass `value`/`onChange` from `useSearchParams`.
State that must survive a tab switch lives in the page.

**Table** `label` · `minWidth?` · `maxHeight?` · `children` (`<thead>` and
`<tbody>` written by the page) · `className?`.
**TableMessageRow** `colSpan` · `children` (Spinner block, EmptyState, or
Alert danger). **NotAvailable**: renders `--` (aria-hidden) plus sr-only "Not
available" for empty cells.

- A real `<table>` in a labelled `role="region"` container with an sr-only
  caption; only the table scrolls horizontally below `minWidth`, never the
  page. The region is a Tab stop (inset focus ring) only while it actually
  overflows, so keyboard users can scroll it; a table that fits adds no stop.
- Touch: under a coarse pointer the row checkbox label, the sort button and
  `.ui-row-button` reach 44px like every other control, and their rows grow
  with them. Measured in the harness at 375px (coarse): checkbox, sort
  button, row button, row IconButtons 44; header with the select-all
  checkbox 52; rows with a checkbox, an sm input or row actions 52; a
  two-line row with a row button 68; text-and-badge rows 36.
- **Sticky header only with `maxHeight`** (the wrapper then scrolls
  vertically). Without it, headers are static; nothing else is promised.
- Class contract: `th scope="col"`; rows 36px; `.ui-cell-2` for two-line
  cells (44px); `.ui-row-actions` wraps row IconButtons (keeps 36px);
  `Input`/`Select size="sm"` in cells; `u-num u-text-end` for quantities;
  `u-mono` for IDs and versions; `td.ui-cell-wrap` for long text that must
  stay readable.
- Selection: `tr data-selected` (never `aria-selected` on a plain table) plus
  a row Checkbox with `aria-label`, a header Checkbox with `indeterminate`,
  and a `role="status"` phrase in the Card header ("2 selected").
- Clickable rows: the primary cell holds a real `<button
  className="ui-row-button">` or `<Link>`; a row `onClick` plus
  `className="ui-row-clickable"` is only a mouse shortcut.

**SortableHeader** `label` · `sortKey` · `sort` · `onSort` ·
`align?: 'start'|'end'`; `nextSort(current, key)` toggles asc/desc (a new
key starts ascending). The whole header cell is a button; `aria-sort` is set
on the sorted column only.

**Pagination** `page` (0-based) · `pageCount` · `onPageChange` · `label`.
`<nav>` with Previous/Next (aria-disabled at the ends) and a "Page x of y"
text that is a polite `role="status"`: a page change, and the focused Next
turning disabled on the last page, are announced as one short phrase.

---

## 8. Hooks

| Hook | Signature | Use |
|---|---|---|
| `useDialogFocus` (`hooks/useDialogFocus.ts`) | `(open, { onClose, dismissible?, initialFocusRef?, rootRef? }) => { panelProps }` | Modal internals and the shell's mobile drawer. Spread `panelProps` on the panel, a `<div>` rendered only while open (for the drawer: a wrapper around the `<nav>`, never the `<nav>` itself, and never the desktop sidebar); `role` and `aria-modal` are returned only while `open`. Pass `rootRef` for the outermost element (overlay or drawer + scrim). Builds on `useModalA11y` (reused unchanged): adds dialog stack, counted inert background, scroll lock, initial focus, a Tab cycle that treats a radio group as one stop, focus fallback. |
| `useSelection` (`hooks/useSelection.ts`) | `<K>(visibleKeys) => { selected, isSelected, toggle, toggleAll, clear, allSelected, someSelected, count }` | Bulk selection. Keys that leave the visible set (page, filter, search) are dropped, so bulk actions never touch hidden rows. |
| `usePending` (`hooks/usePending.ts`) | `<K>() => { isPending(key), anyPending, run(key, task) }` | Per-row in-flight state and double-submit guard. `run` ignores a key already pending and rejects like the task (keep your try/catch + toast). |
| `useDebouncedValue` (`hooks/useDebouncedValue.ts`) | `<T>(value, delayMs = 300) => T` | Server-side filters and typeahead queries; pair with a `let alive = true` cleanup guard. |
| `useConfirm` / `useToast` | see 7.3 | Providers are mounted once, `<ToastProvider><ConfirmProvider>`, directly inside `<BrowserRouter>` in `App.tsx` (so router components work in a confirm description). The early `/privacy` return renders outside them; wrap PrivacyPage separately if it ever needs them. |

`hooks/useModalA11y.ts` stays as is; new code never calls it directly. It is
removed by the integrator once no page uses it.

---

## 9. Content classes and utilities

Content (`ui` layer): `dl.ui-dl` label/value grid (stacks below 600px);
`code.ui-code` / `pre.ui-code`; `pre.ui-log role="log" tabIndex=0` with
`.ui-log__line[--warn|--error|--debug]`, `.ui-log__time`, `.ui-log__level`
(the level word is always printed; WARN/ERROR rows are tinted);
`details.ui-details` + `.ui-details__body`; `fieldset.ui-fieldset` with a
sentence-case `legend`; `.ui-actionbar` sticky bottom Save/Discard bar with a
`border-strong` top edge (the page scroll padding keeps focused controls
clear of it, and the toast column is lifted above it); `.ui-count`;
`.ui-thumb` (16:10, `--square`) image frame; `.ui-nav-item` with
`aria-current="page"` (Sidebar and config rails) and `.ui-nav-group-label`;
`.ui-auth` + `.ui-auth__card` centred auth layout; `.ui-skip-link`;
`.ui-bold-stable` for labels whose weight changes with state.

Layout (`utilities` layer): `.l-page` (max width + page padding + 16px
stack + body font size and line height), `.l-stack` (`--sm` 8, default 16, `--lg` 24), `.l-cluster` (`--end`,
`--between`), `.l-grid--stats` (1/2/4-up at 0/600/1200), `.l-grid--cards`
(auto-fill 280px), `.l-grid--form` (auto-fit 220px), `.l-split` (main +
360px aside from 1200px), `.l-split--rail` + `.l-rail` (220px rail from
900px, horizontal scroller below).
Helpers: `.u-push`, `.u-span-full`, `.u-sr-only`, `.u-muted`,
`.u-secondary`, `.u-mono`, `.u-num`, `.u-text-end`, `.u-text-sm`,
`.u-truncate` (only when the full value is reachable another way),
`.u-wrap-anywhere`.

Inline `style=` is allowed only for data-driven values (meter width, map
coordinates, a Discord role colour swatch, a table `minWidth`).

---

## 10. Page patterns

Keys in the examples below (`common.retry`, `common.save`, …) are
illustrative: use the page's own namespace and add missing keys to both
locales.

### 10.1 Admin list page (Bans, Users, Audit log, Instances…)

```tsx
<div className="l-page">
  <PageHeader title={t("bans.title")} icon={Ban} description={t("bans.count", { count })}
    actions={<Button variant="primary" icon={Plus} onClick={openCreate}>{t("bans.add")}</Button>} />
  {loadError && (
    <Alert tone="danger" title={t("bans.loadFailed")}
      actions={<Button size="sm" icon={RotateCw} onClick={reload}>{t("common.retry")}</Button>}>
      {loadError}
    </Alert>
  )}
  <div className="l-grid--stats">
    <StatTile label={t("bans.active")} value={stats.active} onClick={…} pressed={filter === "active"} />
  </div>
  <Card title={t("bans.list")} flush
    actions={<>
      {refreshing && <Spinner />}
      <SegmentedControl size="sm" label={t("bans.scope")} options={…} value={scope} onChange={setScope} />
      <Input type="search" size="sm" aria-label={t("bans.search")} value={q} onChange={…} />
    </>}
    footer={<Pagination label={t("bans.pages")} page={page} pageCount={pages} onPageChange={setPage} />}>
    <Table label={t("bans.list")} minWidth={720}>
      <thead><tr><th scope="col">…</th><SortableHeader … /></tr></thead>
      <tbody>
        {firstLoad ? <TableMessageRow colSpan={6}><Spinner block label={t("common.loading")} /></TableMessageRow>
          : rows.length === 0 ? <TableMessageRow colSpan={6}><EmptyState icon={Ban} title={t("bans.empty")} /></TableMessageRow>
          : rows.map(row => <tr key={row.id}>…<td><div className="ui-row-actions">
              <IconButton size="sm" icon={Trash2} tone="danger" label={t("bans.unbanName", { name: row.name })}
                loading={pending.isPending(row.id)} onClick={() => unban(row)} />
            </div></td></tr>)}
      </tbody>
    </Table>
  </Card>
</div>
```

Filters sit in the Card header (or a Card of their own when there are many).
Search is either debounced (`useDebouncedValue`) or explicit-submit, never a
mix on one page. Refetches keep rows visible.

### 10.2 Detail page / master-detail (Players, Instances)

`.l-split`: the list Card in the main column, the detail Card in the 360px
aside from 1200px; below 1200px the detail stacks under the list or opens as
`Modal size="lg"`. The detail shows its own loading state. Key/value data in
`dl.ui-dl`; IDs with `CopyButton`; section headings are Card titles (`h2`)
or `h3`. Switching the selected item with unsaved edits asks `useConfirm`.

### 10.3 Settings form (General settings, Discord settings, plugin config)

```tsx
<form className="l-stack" onSubmit={save} noValidate>
  <Card title={t("settings.connection")}>
    <div className="l-grid--form">
      <Field label={t("settings.host")} error={errors.host} required><Input … /></Field>
      <Field label={t("settings.password")} hint={t("settings.passwordHint")}><Input type="password" revealable … /></Field>
      <Switch label={t("settings.autoRestart")} description={…} checked={…} onChange={…} className="u-span-full" />
    </div>
  </Card>
  {dirty && (
    <div className="ui-actionbar">
      <span className="u-secondary u-text-sm">{t("settings.unsaved", { count })}</span>
      <Button variant="ghost" className="u-push" onClick={discard}>{t("common.discard")}</Button>
      <Button type="submit" variant="primary" loading={saving} loadingLabel={t("common.saving")}>{t("common.save")}</Button>
    </div>
  )}
</form>
```

A real `<form>` so Enter submits (in a dialog: `Modal onSubmit`, section 7.3). Validate on blur; on a failed submit keep
inline errors and focus the first invalid control. Saving shows
`loading`; the result is a toast. A settings load failure shows an Alert and
blocks Save (never show defaults as if they were loaded). Tab close with
dirty edits: react-router `useBeforeUnload`; in-page switches and Discard:
`useConfirm`. (`useBlocker` is unavailable with `<BrowserRouter>`.)
Config editors with a module rail use `.l-split--rail` with `.ui-nav-item`.

### 10.4 Player dashboard (standalone and embedded)

Root: `<main id="main-content" tabIndex={-1} className="l-page">` standalone
(`<div className="l-page">` embedded), with `ui-scope-player` on `<body>`
while standalone (section 5).
The hero is a page composition (Card or a `PlayerDashboardPage.module.css`
block on tokens only): Avatar lg, name, VIP Badge, balance in mono tabular.
KPIs in `.l-grid--stats` with StatTile; rank percentile with Meter; requests
with Badge tones; account deletion through `useConfirm` with `confirmText`.
No Discord brand gradient, no white-on-translucent buttons, no emoji. The
Wrapper component is declared at module scope (a component declared inside
render remounts the tree and drops input focus on every keystroke). Embedded
mode must not force a single column.

### 10.5 Market

`ui-scope-player` on `<body>` when standalone (section 5); sections are Tabs. Item grid
`.l-grid--cards` of static item cards (page CSS module): `.ui-thumb` media
with a lazy image, QualityBadge on the media (or a neutral "Q{n}" Badge
until the tier mapping exists), name 16px/600, meta 14px secondary, price
18px mono tabular with a muted "pts" unit (a Coins icon, no emoji), and a
primary Buy button whose `aria-label` includes item and price ("Buy Rex
Saddle for 7,200 points"). **The card has no hover state**: only Buy is
clickable. Disabled-buy reasons are visible text next to the button.

Buy opens `Modal size="sm"` with a `dl.ui-dl` summary (price, balance,
balance after), `initialFocusRef` on Cancel; on failure the dialog stays open
and shows an Alert inside. Browse search is debounced and keeps the grid
visible while refetching. All Italian literals move to i18n.

---

## 11. Iconography

- **Lucide only** (`lucide-react`), 24-unit grid, outline style, round caps.
  No emoji, no text glyphs (`+`, `×`, `▲`, `⚡`, `●`) as icons.
- Sizes: `--icon-xs` 12 (badges, stroke 2.25), `--icon-sm` 16 (buttons,
  nav, tables, inputs, labels), `--icon-md` 20 (alerts, toasts, page title,
  empty-state disc), `--icon-lg` 32 (media placeholders). Stroke 1.75.
  Primitives size their icons in CSS; in page code pass
  `size={16} strokeWidth={1.75}`.
- Decorative icons beside text get `aria-hidden="true"` (primitives do it).
  Icon-only controls use IconButton (required label). A meaningful
  standalone icon needs a text alternative next to it (sr-only text).
- Status icons: CircleCheck (success/online), TriangleAlert
  (warning/degraded), CircleAlert (danger/error/crashed), Info, RefreshCw
  (updating), CircleOff (offline), CircleHelp (unknown), LoaderCircle
  (spinner).
- The Discord brand colour appears only inside `DiscordIcon`.

---

## 12. i18n keys owned by the foundation

Add to **both** `en.json` and `it.json` in one change (the harness merges
them at runtime until then). Reused existing keys: `common.cancel`,
`common.close`, `common.loading`.

| Key | EN | IT |
|---|---|---|
| `ui.dismiss` | Dismiss | Chiudi |
| `ui.dismissNotification` | Dismiss notification | Chiudi notifica |
| `ui.notifications` | Notifications | Notifiche |
| `ui.copied` | Copied | Copiato |
| `ui.copyFailed` | Could not copy to the clipboard | Impossibile copiare negli appunti |
| `ui.showPassword` | Show password | Mostra password |
| `ui.notAvailable` | Not available | Non disponibile |
| `ui.noResults` | No results | Nessun risultato |
| `ui.typeToConfirm` | Type {{text}} to confirm | Digita {{text}} per confermare |
| `ui.selectedCount_one` / `_other` | {{count}} selected | {{count}} selezionato / selezionati |
| `ui.noneSelected` | None selected | Nessuna selezione |
| `ui.pagination.previous` / `next` / `pageOf` | Previous / Next / Page {{page}} of {{total}} | Precedente / Successiva / Pagina {{page}} di {{total}} |
| `ui.tone.info` / `success` / `warning` / `error` | Information: / Success: / Warning: / Error: | Informazione: / Operazione riuscita: / Attenzione: / Errore: |
| `ui.status.*` | Online, Offline, Updating, Crashed, Error, Degraded, Testing, Unknown | Online, Offline, In aggiornamento, Arresto anomalo, Errore, Degradato, Test in corso, Sconosciuto |
| `ui.quality.label` + tiers | Quality:, Primitive, Ramshackle, Apprentice, Journeyman, Mastercraft, Ascendant | Qualità:, Primitivo, Scadente, Apprendista, Esperto, Maestro, Ascendente |

Page groups add keys only under their own namespaces. Group labels and role
labels of the sidebar move to `nav.*` in sentence case.

---

## 13. Accessibility checklist (per page, before delivery)

Adapted from ui-ux-pro-max `pro-rules.md` (pre-delivery checklist) and
`quick-reference.md` §1 to §3 for a web admin panel.

Process
- [ ] `npx tsc --noEmit -p .` passes; the acceptance greps (section 14) are clean.
- [ ] Checked at 1440px and 375px in **both** themes: no page-level
      horizontal scroll, nothing hidden behind the sticky bar or the mobile top bar.
- [ ] Checked with reduced motion on and at 200% browser zoom (no clipped
      text, no overlapping controls).

Keyboard and focus
- [ ] Every action is reachable and operable by keyboard; tab order equals
      visual order at every width.
- [ ] Focus is visible everywhere (never `outline: none` without the ring).
- [ ] Dialogs: focus moves in, Tab wraps, Escape closes the top one only,
      focus returns to the trigger. Form dialogs use `Modal onSubmit`, so Enter submits.
- [ ] Tabs: arrows, Home, End. Combobox: arrows, Enter, Escape, Tab.
- [ ] No single printable-key shortcuts; a search shortcut, if one is ever
      added, is Ctrl/Cmd+K.
- [ ] On route change focus lands on `#main-content`; the skip link works.

Names, roles, states
- [ ] Every input, select and textarea is in a Field or has `aria-label`.
- [ ] Every icon-only control is an IconButton with a verb + object label.
- [ ] Toggles expose `aria-pressed`, expanders `aria-expanded` +
      `aria-controls`, the current nav item `aria-current="page"`.
- [ ] No `aria-label` on generic `span`/`div`; no `aria-selected` on plain
      table rows; headings are sequential with one `h1`.
- [ ] Unavailable actions stay visible with `disabled` (aria-disabled), and
      the reason is visible text when it is not obvious.
- [ ] Changing counts and results are announced as complete phrases in one
      status region ("2 selected"), not bare numbers.

Colour and content
- [ ] No meaning by colour alone: status = icon + word; quality = tier name;
      selection = checkbox + bar; pressed and checked = fill + accent edge
      (+ weight on labelled controls).
- [ ] Only tokens; any new tint stack re-measured (section 3.7).
- [ ] Destructive actions are `danger`, set apart (`u-push`) and confirmed.
- [ ] Errors say cause and fix, sit next to their field or inside their
      dialog, and keep the user's input.
- [ ] Empty, loading and error states are distinct (EmptyState, Spinner,
      Alert) and data stays visible while refetching.
- [ ] Images have `alt` (decorative `alt=""`); media frames reserve space.
- [ ] Login and password fields allow paste and password managers.

Pointer and motion
- [ ] Targets at least 24px (44px under a coarse pointer); spacing between
      adjacent row actions at least 4px.
- [ ] Only fully clickable surfaces react on hover.
- [ ] Animations are transform/opacity/colour only, under
      `prefers-reduced-motion: no-preference`; JS smooth scrolling checks
      `matchMedia('(prefers-reduced-motion: reduce)')`.
- [ ] Forced colours: selected rows, switches, badges, pressed controls and
      the active nav item keep a system-colour indicator (primitives do this;
      page CSS must not remove it).

---

## 14. Rules for page work, and the checks that hold them

The migration is done: there is no legacy sheet, no bridge and no `legacy`
layer left to work around. What follows is the standing contract for a new
page, a new tab, or any change to an existing one.

**Ownership.** A page change stays inside its page folder and its CSS
module. `components/ui/*`, `styles/*`, `hooks/*`, `main.tsx`,
`services/api.ts`, `types/index.ts` and `utils/*` are shared foundation: a
missing variant, a missing API method or a missing token is a deliberate
change to the foundation, made with this file updated in the same commit —
never worked around locally with a one-off style or a local `fetch`.

1. **Build from the primitives.** Every control, surface, message, overlay
   and table comes from `components/ui`; every layout from an `l-*` class or
   the page's own CSS module. A page that needs a primitive to do something
   new asks for the variant; it does not restyle the primitive from outside.
2. **No inline colours** (hex, `rgba`, `color + '33'`), no px font sizes, no
   fixed `gridTemplateColumns`, no `e.currentTarget.style` hover mutations,
   no injected `<style>` tags, no z-index literals. Tokens only, in CSS.
3. **A page CSS module is layout only** — grid, flow and sizes, expressed in
   tokens. It repeats `@layer reset, base, ui, page, utilities;` verbatim on
   its first line and wraps its rules in `@layer page { … }`. Colour, type
   and state belong to the primitives, which is why the `page` layer sits
   above `ui`: a module can position a primitive, not repaint it.
4. **No `window.confirm`, bare `confirm(`, `window.alert`, `window.prompt`:**
   `useConfirm`, a toast, or a small Modal with a Field. Pages never call
   `hooks/useModalA11y` directly either — it is Modal's internal.
5. **All strings through `t()`**, added to `en.json` **and** `it.json` in the
   same commit, under the page's own namespace. No hardcoded Italian and no
   hardcoded English.
6. **Role gating via `currentUser`** (the prop App passes to every page):
   `const isAdmin = currentUser?.role === 'admin'`,
   `const canOperate = isAdmin || currentUser?.role === 'operator'`. Hide
   controls a role can never use; show temporarily unavailable ones
   `disabled` with a visible reason. Pass `isAdmin`/`canOperate` explicitly
   into extracted components (no default `true`). The backend stays the
   authority: the UI hides what a role cannot do, it never grants it.
7. All HTTP through `services/api.ts`; errors through `utils/errors`
   (`extractError`), never `err.message` directly.
8. No `dangerouslySetInnerHTML`; use `<Trans>` or interpolation.
9. Destructive actions are `danger` + `useConfirm`; irreversible mass
   actions add `confirmText`.
10. **Overlays are `Modal`.** A hand-built `position: fixed` panel has no
    dialog stack, so one Escape closes two things and a toast raised from
    inside it lands underneath. There is no stacking override to lean on any
    more (section 4.6).
11. Split a page before it stops fitting in one head: page folder,
    `index.tsx` as the default export at the original import path,
    `components/` and `hooks/` beside it. Split in a no-behaviour-change
    commit; bug fixes get their own.

### Verification

```sh
cd frontend
npx tsc --noEmit -p .

# The cascade-layer statement is identical in every sheet that declares one.
# Expect exactly one line: "@layer reset, base, ui, page, utilities;"
grep -rhE '^@layer [a-z, ]+;' src | sort -u
# NOT CLEAN YET: on this branch it also returns the stale
# "@layer reset, legacy, base, ui, page, utilities;" from 22 page and shell
# modules still being converted, and 2 modules declare no statement at all
# (pages/LeaderboardPage.module.css, pages/PlayerMapPage/PlayerMapPage.module.css
# — they work only because index.css is imported first in main.tsx). Harmless
# at runtime: the unknown `legacy` name is appended after `utilities` and
# stays empty. Clear it in one pass when the page work lands (and add the
# statement to the 2 that lack one), then delete this note:
#   grep -rl '^@layer reset, legacy,' src | xargs \
#     sed -i 's/^@layer reset, legacy, /@layer reset, /'

# No stylesheet outside styles/ and components/ui/ that is not a CSS module.
# Expect nothing.
find src -name '*.css' ! -name '*.module.css' \
  ! -path 'src/styles/*' ! -path 'src/components/ui/*'

# Every custom property a rule reads is defined somewhere. Expect nothing:
# this is what catches a token renamed in tokens.css but not in a page.
grep -rhoE 'var\(--[a-z0-9-]+' src --include='*.css' --include='*.tsx' \
  | sed 's/var(//' | sort -u > /tmp/used
grep -rhoE '\-\-[a-z0-9-]+ *:' src --include='*.css' | sed 's/ *:$//' \
  | sort -u > /tmp/defined
comm -23 /tmp/used /tmp/defined

# The deleted system does not come back. Expect nothing.
grep -rn 'legacy-aliases\|@layer legacy' src
```

Over the files a change touches, expect nothing for: `window.confirm`,
`window.alert`, `window.prompt`, bare `confirm(`, `useModalA11y`,
`dangerouslySetInnerHTML`, `<style>`, `gridTemplateColumns`, `onMouseEnter`
style mutations, hex/`rgba` literals inside `style` props, and the class
names of the deleted sheet (`btn`, `pl-`, `sf-`, `gc-`, `as-`, `bp-`,
`form-input`, `page-header`, `page-container`, `machine-card`) — each of
those had a primitive, and the primitives are section 7.

---

## 15. Deviations from candidate A (and why)

| Candidate A | Now | Why |
|---|---|---|
| Light focus ring = accent `#4A4FD0`; dark ring `#B3B9FF` (accent hue) | Neutral ring: `#FFFFFF` dark, `#000000` light | Judges: focus on a selected tab or nav item merged with selection. Neutral clears 3:1 on every plane and against the accent fill in both themes. |
| Dark accent `#8E97FF` (fill and ink), hover `#A9B0FF` | Fill `#737ADF`, hover `#7E86EC`, new ink token `--color-accent-text` `#A3AAFF` | A white ring cannot reach 3:1 next to a light fill; the fill was darkened (text-on-accent still 5.10) and the ink kept light for text contrast. |
| Light accent hover `#3A3EB0` (darker) | `#565CDB` (lighter) | Keeps the black ring at 3.95:1 next to the hovered fill. |
| Dark accent-subtle alpha .14 | .18 | Visible selection tint after the fill darkened. |
| Dark `--color-border-strong` `#69717E` (2.85 on surface-active) | `#747C89` (3.33 minimum) | 3:1 on every plane. |
| Secondary button edge `--color-border` (1.32:1) | `--color-border-strong` | Judge: barely bounded. |
| Market rarity on series-1/series-4 (inverted) | Dedicated `--color-quality-*` on ASA tiers + tier name | Judge defect; quality never borrows status, accent or series. |
| "/" focuses search | No single-key shortcut, no global search | WCAG 2.1.4. Search, if added, binds Ctrl/Cmd+K. |
| Dialog footer `column-reverse` below 600px | `column` in DOM order | Visual order = tab order. |
| Reduced motion via override (lost on specificity) | Motion declared only under `no-preference`, no global override at all | Nothing to override, nothing to lose. The `!important` net in `base.css` existed for the legacy sheet's unguarded animations and went with it (section 4.5). |
| Sticky header in an `overflow-x` wrapper (never stuck) | Sticky only with Table `maxHeight` (vertical scroller) | Only promise what works. |
| `aria-selected` on `<tr>`; `aria-label` on span/div | `tr[data-selected]` + checkbox; sr-only text | ARIA misuse. |
| Rows declared 36/44, rendered 52 | 4px padding + 28px line box + inset separators: 36/44 measured | Judge measurement. |
| Market cards and static cards change border on hover | Only StatTile link/button tiles react | False affordance. |
| Loading = native `disabled` in places | `aria-disabled` + guard everywhere | Focus is never dropped. |
| Google Fonts at runtime | Self-hosted Fontsource | GDPR. |
| Updating shown as warning in C/B | Updating = info | Never confused with Crashed or Mastercraft. |
| Danger button: A tinted; B solid in confirm dialogs | Tinted everywhere | One danger look; shape and position set it apart. |
| Toasts: A auto-dismiss all | success/info 5s with pause on hover/focus; error persists with an action | Graft; an ops error must not vanish. |
| KPI meta muted | metaTone: status colour + icon + words | Graft. |
| No forced-colours rules beyond row/switch | Selected rows, switches, badges, quality chip, pressed buttons, segments, tabs, active nav, pressed tiles, meters | Graft. |

---

## 16. ui-ux-pro-max queries and what was applied

| Query | Applied |
|---|---|
| `"modal dialog focus" --domain ux` | Visible 2px ring on every dialog control, 2px offset (focus appearance); focus never hidden under sticky UI. |
| `"toast notification live region" --domain ux` | 5s auto-dismiss kept for success/info only; errors persist (deliberate deviation for ops errors); status phrases announced as complete sentences in one region ("2 selected"), not bare numbers. |
| `"data table density sort" --domain ux` | Tables scroll inside an `overflow` wrapper instead of breaking the layout; checkbox column + card-header bulk actions (useSelection); `aria-sort` on sortable headers. |
| `"form field error helper" --domain ux` | Error under the field linked with `aria-describedby`; cause + fix wording; after a failed submit focus the first invalid control (error-summary pattern allowed for long forms: Alert at the top with links, inline errors kept). |
| `"component composition memo" --stack react` | Composition via `children` and slots (Card `actions`/`footer`, Table with page-written `thead`/`tbody`) instead of config frameworks; context only for Field wiring, toasts and confirm; no blanket `React.memo` in primitives. |
| `"focus not obscured" --domain ux` | `scroll-padding-bottom` while `.ui-actionbar` is present and `scroll-padding-top` inside capped tables (foundation); `scroll-padding-top` under the sticky mobile top bar (shell rule, section 4.7). |
| `"character key shortcuts" --domain ux` | 0 results; retried as `"keyboard shortcuts"` (keyboard navigation and skip links). Rule applied from WCAG 2.1.4 directly: no single printable-key shortcuts. |
| `"icon button accessible label" --domain icons` | Context-based icon semantics (decorative `aria-hidden`, icon controls named, pressed/expanded exposed). The Phosphor recommendation was not applied: Lucide is mandated. |
| `pro-rules.md` / `quick-reference.md` | Pre-delivery checklist (section 13), stable press states (no layout shift: bold-stable labels, scale only under no-preference), token-driven theming, scrim measured per theme, 24px web target minimum with 44px under coarse pointers. |

---

## 17. UI-kit harness (permanent, dev-only)

`frontend/uikit.html` + `frontend/src/uikit/main.tsx` render every primitive
in every variant and state, with theme, language and player-density toggles
(the density toggle puts `ui-scope-player` on `<body>`, exactly like the
player pages) and live row-height measurements. Run `npx vite` in
`frontend/` and open `/uikit.html`.

**It is kept.** It is the only way to see the whole kit — every variant,
both themes, both densities, both locales, coarse pointer, reduced motion,
forced colours — without a backend, a database or a logged-in session. It
is where a new variant is proved before a page depends on it, and where a
token change is checked against everything it touches at once.

It stays out of production by construction, not by discipline: `vite build`
takes `index.html` as its only input, so nothing under `src/uikit/` is
reachable from the app's entry graph and nothing of it is emitted into
`dist/`. `uikit.html` also carries `<meta name="robots" content="noindex">`.
It uses the real `src/i18n` bundles and the real `components/ui` barrel, so
a primitive whose API changes breaks the harness at `tsc` time — which is
the point. Keep it compiling: it is covered by `npx tsc --noEmit -p .`.

---

## 18. Decisions the code now records

What the four open questions of the migration became. Read this before
re-opening one of them.

1. **Integer item `quality` → ASA tier: still unmapped, and the UI says so
   honestly.** The Market renders a neutral `Badge` reading `Q{n}`, hidden
   entirely when `quality` is 0. Three call sites, and they are not the same
   shape:

   - `MarketPage/components/ItemCard.tsx:96` — a `<Badge>`.
   - `MarketPage/tabs/ShopTab.tsx:189` — a `<Badge>`.
   - `MarketPage/tabs/MyItemsTab.tsx:82` — **not** a badge: the quality is
     interpolated into a text line (`` ` · ${t("market.card.quality")}` ``).
     It needs restructuring into an element, not a prop swap.

   ArkShop shows no quality at all; its only mention is the `Field` label in
   `ArkShopPage/components/EntryDialog.tsx:58`, which is an input, not a
   display. The `QualityBadge` primitive and the six `--color-quality-*`
   tokens exist and are exercised by the UI-kit harness, waiting for the
   mapping. When the plugin's integer range is confirmed, the change is one
   helper returning a `QualityTier`, swapped in at the two `Badge` sites —
   no token and no primitive work. Do not guess the ranges: a wrong tier is
   worse than `Q{n}`.
2. **Neutral focus ring: shipped and load-bearing.** `--color-focus-ring` is
   `#FFFFFF` in dark and `#000000` in light, drawn by one rule in `base.css`
   (`:focus-visible { outline: 2px solid …; outline-offset: 2px }`) that
   components only ever adjust by `outline-offset`. The dark accent fill was
   darkened to `#737ADF` so the white ring keeps 3:1 beside it (section 3.2,
   section 15). The ring, the fill and that contrast figure move together:
   changing the accent means re-measuring the ring, not just picking a hue.
3. **Italian tier names: defined, and they are Italian.** `ui.quality.*` in
   `frontend/src/i18n/locales/it.json` is Primitivo / Scadente / Apprendista
   / Esperto / Maestro / Ascendente, against Primitive / Ramshackle /
   Apprentice / Journeyman / Mastercraft / Ascendant in `en.json`. Both
   locales carry all six plus `ui.quality.label`, so `QualityBadge` always
   writes the tier name — which is the accessibility requirement behind it
   (section 3.4), not a nicety. If the game's Italian localisation ever
   disagrees, change `it.json` only.
4. **Sidebar footer: no account menu.** Language, theme and logout stay
   visible in the sidebar and in the drawer, one tap each.
