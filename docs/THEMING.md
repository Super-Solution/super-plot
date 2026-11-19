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
before relying on them. A shared theme package would remove the need (see OPEN-DECISIONS).

## Export

`resolveVars(svg)` replaces every `var(--x, fallback)` with its fallback, for PNG, email and PDF where CSS variables do not exist.
`SuperPlot#toSvg()` and `toPng()` do this for you.

## Colour-vision-safe preset

`theme: 'accessible'` (and `'accessible-dark'`) swaps the palette for Okabe-Ito hues ordered so neighbours stay apart under deutan, protan and tritan vision: `#0072B2 #E69F00 #009E73 #D55E00 #CC79A7 #56B4E9 #7B6BC6 #A0522D`. Up and down use blue and vermillion instead of green and red. It is a registered theme, so it composes with everything else: `createTheme('accessible', { barRadius: 8 })`. Checked with the dataviz palette validator in light mode: every check passes; light blue, orange and pink are under 3:1 contrast on white, so they rely on the legend and the tooltip (identity is never colour alone).

## Font

The font is not inherited from the page. Set `--sp-font` on the host (or an ancestor) to restyle it, or `createTheme(base, { font })`.

## Default palette

`#2962FF #FF9800 #089981 #9C27B0 #00BCD4 #F23645 #FBC02D #E91E63` (TradingView set). Light: background `#FFFFFF`, text `#131722`,
grid `#EEF0F5`. Dark: background `#131722`, surface `#1E222D`, text `#D1D4DC`, grid `#232733`.
More than eight series gives a `too_many_series` warning rather than a generated ninth colour; a pie merges the tail into "Other".
