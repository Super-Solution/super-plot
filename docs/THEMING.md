# Theming

Every colour in the output is `var(--sp-<token>, <fallback>)`, so one render can be restyled three ways.

## 1. CSS variables (no re-render)

```css
.my-card {
  --sp-series-1: #e8445a;     /* first series */
  --sp-series-2: #1f8a70;
  --sp-text: #222;
  --sp-grid: #f3e3e6;
  --sp-font: Georgia, serif;
}
```

Tokens: `background surface text text-muted grid axis border positive negative warning info other seq-low seq-high div-low div-mid div-high land ocean nodata`,
plus `series-1` to `series-8` and `font` (`--sp-font`, a font-family list). Set them on the plot, a parent, or `:root`.
Waterfall bars use `positive` (increase), `negative` (decrease) and `text-muted` (total); bullet ranges are `text-muted` at three opacities and the target tick is `text`.

## 2. Theme object

```ts
import { createTheme, registerTheme } from '@supersolutions/super-plot-core'
const brand = createTheme('dark', { name: 'brand', palette: ['#7C5CFF', '#00C2A8'], barRadius: 8, lineWidth: 3 })
registerTheme(brand)
renderToSvg(spec, { theme: 'brand' })     // or: theme: brand
```

Metrics you can change: `font fontSize titleSize lineWidth barRadius gap`. `createTheme(base, overrides)` never mutates the base.

## 3. The spec

```json
{ "type": "line", "colors": { "Revenue": "#f06", "Cost": "var(--brand-grey)" } }
```

Colour follows the series, not its position: hiding a series does not repaint the others.

## Sharing tokens with Super Chart

`alias` puts other variables in front of the fallback, so a page that already themes Super Chart gets matching plots:

```ts
createTheme('light', { alias: { text: ['--sc-text'], grid: ['--sc-grid'], background: ['--sc-bg'] } })
```

Result: `var(--sp-text, var(--sc-text, #131722))`. Check the variable names against Super Chart's current tokens
before relying on them. The design system document is the shared source for the values; a shared theme package is still not built (see OPEN-DECISIONS).

## shadcn/ui

`theme: 'shadcn'` reads shadcn's own tokens, so a shadcn project's charts follow its theme (light, dark, custom) with no configuration: `--chart-1` to `--chart-5` for the first five series (then the default palette), `--card` / `--background` for the background, `--popover` for tooltips, `--card-foreground` / `--foreground` for text, `--muted-foreground`, `--border` for grid, axis and borders, `--destructive` for negative values. Each still sits behind `--sp-*`, so `--sp-series-1` overrides `--chart-1`. Exports (PNG, `toSvg`, `renderToSvg`) use the plain fallbacks, as for every theme.

## Textures

`patterns: true` in the spec gives each series one of eight 8 px textures (stripes, dots, cross-hatch...) drawn over its fill in the background colour at 60% opacity, on bars, areas, slices, cells and legend swatches, in SVG and canvas alike. Use it for colour-blind readers and greyscale print; the colours do not change.

## Export

`resolveVars(svg)` replaces every `var(--x, fallback)` with its fallback, for PNG, email and PDF where CSS variables do not exist.
`SuperPlot#toSvg()` and `toPng()` do this for you.

## Colour-vision-safe preset

`theme: 'accessible'` (and `'accessible-dark'`) swaps the palette for Okabe-Ito hues ordered so neighbours stay apart under deutan, protan and tritan vision: `#0072B2 #E69F00 #009E73 #D55E00 #CC79A7 #56B4E9 #7B6BC6 #A0522D`. Up and down use blue and vermillion instead of green and red. It is a registered theme, so it composes with everything else: `createTheme('accessible', { barRadius: 8 })`. Checked with the dataviz palette validator in light mode: every check passes; light blue, orange and pink are under 3:1 contrast on white, so they rely on the legend and the tooltip (identity is never colour alone).

## Font

The font is not inherited from the page. Set `--sp-font` on the host (or an ancestor) to restyle it, or `createTheme(base, { font })`.

## Default palette and the design system

The defaults are the Super Solution design system (`super-dev-docs/docs/20-contracts/design-system.md`), so a plot in Super Chat, beside a Super Editor report or in your own page looks like the rest of the family. Neutrals, status colours and the accent are Super Chat's kit values; the series palette is the family's validated set, led by the accent violet.

| | Light | Dark |
|---|---|---|
| Series 1 to 8 | `#6C4AF2 #2FAE75 #E76D3C #2E73D4 #E6A41F #E8729E #008200 #DC4749` | `#9379FF #259D6E #D65D32 #408AE9 #CC8300 #DC4D7C #0FA000 #E16B6A` |
| Background, surface | `#FFFFFF`, `#FFFFFF` | `#17171A`, `#1D1D21` |
| Text, muted | `#111113`, `#5F5F68` | `#F4F4F5`, `#A1A1AA` |
| Grid, axis, border | `#E4E4E7`, `#8A8A94`, `#E4E4E7` | `#2A2A30`, `#6B6B75`, `#2A2A30` |
| Accent | `#6C4AF2` | `#A28CFF` |
| Positive, negative, warning, info | `#12805C #C2362B #9A6400 #2B6CB0` | `#4FD1A1 #FF7B72 #E0A53A #6B9BFF` |
| Sequential | `#ECE8FF` to `#6C4AF2` | `#262050` to `#A28CFF` |
| Diverging | violet, `#F2F2F4`, orange `#C8590C` | `#A28CFF`, `#2A2A30`, `#E0702C` |

Each mode has its own steps of the same eight hues. Adjacent series pass the dataviz palette validator (lightness band, chroma floor, protan and deutan separation of at least 8, normal-vision separation of at least 15) and Super Plot's own check (`colors_indistinct`, tritan included) in both modes. Light series 2, 5 and 6 (green, amber, pink) are between 2:1 and 3:1 on white: the legend, tooltips, `dataTable` and `patterns` carry identity, never colour alone. A ninth series gives a `too_many_series` warning rather than a generated colour; a pie merges the tail into "Other".

**Accent.** `--sp-accent` is what an assistant added: an annotation with `by: "assistant"` and no `tone` is drawn in it (violet means the agent). In Super Chat the plugin takes it from the host's `accent` token, so a host with its own accent recolours it. Series 1 is the same violet; give a host's data its own colours with `--sp-series-N` or `colors`.

**TradingView look.** The palette and neutrals Super Plot shipped with stay as the `tradingview` and `tradingview-dark` themes, for finance dashboards that sit beside Super Chart: `#2962FF #FF9800 #089981 #9C27B0 #00BCD4 #F23645 #FBC02D #E91E63`, text `#131722`, grid `#EEF0F5`, dark background `#131722`.
