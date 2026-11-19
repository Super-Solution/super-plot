import type { Measure } from './util/text.js'

/**
 * A theme is plain data. Colours are emitted into the scene as `var(--sp-<token>, <value>)`, so
 * the same output can be restyled three ways without re-rendering:
 *   1. CSS: set `--sp-series-1: #f06` (or any token) on the host or an ancestor.
 *   2. Theme object: `createTheme('dark', { palette: [...] })` for metrics and values.
 *   3. Spec: `colors: { Revenue: '#f06' }` for one series.
 */
export interface Theme {
  name: string
  mode: 'light' | 'dark'
  /** token name (without the `--sp-` prefix) to a CSS colour. */
  colors: Record<string, string>
  /** Categorical series colours in fixed order. */
  palette: string[]
  font: string
  fontSize: number
  titleSize: number
  lineWidth: number
  /** Rounded data-end of bars, in px. */
  barRadius: number
  /** Surface gap between touching marks, in px. */
  gap: number
  /** Other CSS variables to try before the fallback, e.g. `{ text: ['--sc-text'] }`. */
  alias: Record<string, string[]>
}

export type ThemeInput = Partial<Omit<Theme, 'colors' | 'alias'>> & {
  colors?: Record<string, string>
  alias?: Record<string, string[]>
}

export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif'

/**
 * Categorical palette: the TradingView set, ordered so neighbours differ in hue and in
 * colour-vision-deficiency simulation. Never cycled silently: series beyond the 8th produce a warning.
 */
export const PALETTE = ['#2962FF', '#FF9800', '#089981', '#9C27B0', '#00BCD4', '#F23645', '#FBC02D', '#E91E63']

const BASE: Omit<Theme, 'name' | 'mode' | 'colors'> = {
  palette: PALETTE,
  font: FONT_STACK,
  fontSize: 12,
  titleSize: 16,
  lineWidth: 2,
  barRadius: 4,
  gap: 2,
  alias: {}
}

const LIGHT_COLORS: Record<string, string> = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  text: '#131722',
  'text-muted': '#5F6270',
  grid: '#EEF0F5',
  axis: '#D1D4DC',
  border: '#D1D4DC',
  positive: '#089981',
  negative: '#F23645',
  warning: '#FF9800',
  info: '#2962FF',
  other: '#A3A6AF',
  'seq-low': '#E3ECFF',
  'seq-high': '#2962FF',
  'div-low': '#2962FF',
  'div-mid': '#E6E8EE',
  'div-high': '#FF9800',
  land: '#E6E8EE',
  ocean: '#F4F7FC',
  nodata: '#D9DCE3'
}

const DARK_COLORS: Record<string, string> = {
  background: '#131722',
  surface: '#1E222D',
  text: '#D1D4DC',
  'text-muted': '#9EA3B0',
  grid: '#232733',
  axis: '#363A45',
  border: '#363A45',
  positive: '#089981',
  negative: '#F23645',
  warning: '#FF9800',
  info: '#2962FF',
  other: '#6B7080',
  'seq-low': '#1C2744',
  'seq-high': '#4C8DFF',
  'div-low': '#4C8DFF',
  'div-mid': '#3A3F4C',
  'div-high': '#FFA726',
  land: '#2A2E39',
  ocean: '#161B26',
  nodata: '#3A3F4C'
}

export const light: Theme = freeze({ name: 'light', mode: 'light', colors: LIGHT_COLORS, ...BASE })
export const dark: Theme = freeze({ name: 'dark', mode: 'dark', colors: DARK_COLORS, ...BASE })

function freeze(t: Theme): Theme {
  return Object.freeze({ ...t, colors: Object.freeze({ ...t.colors }), palette: Object.freeze([...t.palette]) as string[], alias: Object.freeze({ ...t.alias }) }) as Theme
}

const registry = new Map<string, Theme>([['light', light], ['dark', dark]])

/** Register a named theme so a spec host can select it with `theme: 'name'`. */
export function registerTheme(theme: Theme): void {
  registry.set(theme.name, freeze(theme))
}

export const listThemes = (): string[] => [...registry.keys()]

/** Derive a theme from a base (`'light'`, `'dark'` or a registered name) with overrides. */
export function createTheme(base: string | Theme, input: ThemeInput = {}): Theme {
  const b = typeof base === 'string' ? registry.get(base) ?? light : base
  return freeze({
    ...b,
    ...input,
    name: input.name ?? b.name,
    mode: input.mode ?? b.mode,
    colors: { ...b.colors, ...input.colors },
    palette: input.palette ?? b.palette,
    alias: { ...b.alias, ...input.alias }
  })
}

/**
 * Colour-vision-safe presets (Okabe-Ito hues, reordered so neighbours stay apart under deutan/protan/tritan; yellow and grey dropped because they fail the lightness and chroma bands). Checked with the dataviz palette validator in light mode: all checks pass; light-blue, orange and pink are under 3:1 contrast on white, so they rely on legends and tooltips: `accessible` and
 * `accessible-dark`. Up/down tokens use blue and vermillion instead of green and red.
 */
const ACCESSIBLE = ['#0072B2', '#E69F00', '#009E73', '#D55E00', '#CC79A7', '#56B4E9', '#7B6BC6', '#A0522D']
const ACCESSIBLE_TOKENS = { positive: '#0072B2', negative: '#D55E00', info: '#0072B2', warning: '#E69F00', 'seq-high': '#0072B2', 'div-low': '#0072B2', 'div-high': '#D55E00' }
registerTheme(createTheme('light', { name: 'accessible', palette: ACCESSIBLE, colors: ACCESSIBLE_TOKENS }))
registerTheme(createTheme('dark', { name: 'accessible-dark', palette: ACCESSIBLE, colors: { ...ACCESSIBLE_TOKENS, 'seq-high': '#56B4E9' } }))

/**
 * `shadcn`: reads a shadcn/ui project's own tokens (Tailwind v4 style, full colour values such as
 * `--chart-1: oklch(...)`), so a chart matches the app with no setup and follows its `.dark` class. Series 1-5
 * are `--chart-1..5`; 6-8 fall back to the Super palette. Projects whose tokens are bare HSL channels
 * (`--chart-1: 12 76% 61%`, Tailwind v3) set `--sp-series-1: hsl(var(--chart-1))` and so on instead.
 */
const SHADCN_COLORS: Record<string, string> = {
  background: 'var(--card, var(--background, #FFFFFF))',
  surface: 'var(--popover, var(--background, #FFFFFF))',
  text: 'var(--card-foreground, var(--foreground, #131722))',
  'text-muted': 'var(--muted-foreground, #5F6270)',
  grid: 'var(--border, #EEF0F5)',
  axis: 'var(--border, #D1D4DC)',
  border: 'var(--border, #D1D4DC)',
  negative: 'var(--destructive, #F23645)'
}
registerTheme(createTheme('light', {
  name: 'shadcn',
  colors: SHADCN_COLORS,
  palette: [...PALETTE.slice(0, 5).map((c, i) => `var(--chart-${i + 1}, ${c})`), ...PALETTE.slice(5)]
}))

export type ThemeOption = 'light' | 'dark' | 'auto' | string | Theme

/** Turn a render option into a Theme. `'auto'` follows `prefersDark` (the web binding passes the media query). */
export function resolveTheme(option: ThemeOption | undefined, prefersDark = false): Theme {
  if (option && typeof option === 'object') return option
  if (option === 'auto' || option === undefined) return prefersDark ? dark : light
  return registry.get(option) ?? light
}

const VAR_NAME = /^--[a-z0-9_-]+$/i

/** `var(--sp-text, #131722)`, with aliases chained in front of the fallback. */
export function cssVar(theme: Theme, token: string): string {
  let out = theme.colors[token] ?? theme.colors.text
  const chain = [`--sp-${token}`, ...(theme.alias[token] ?? []).filter(v => VAR_NAME.test(v))]
  for (let i = chain.length - 1; i >= 0; i--) out = `var(${chain[i]}, ${out})`
  return out
}

export function seriesVar(theme: Theme, index: number): string {
  const n = theme.palette.length
  const i = ((index % n) + n) % n
  return `var(--sp-series-${i + 1}, ${theme.palette[i]})`
}

/** The plain value behind a token (for maths such as colour interpolation). */
export const tokenValue = (theme: Theme, token: string): string => resolveVars(theme.colors[token] ?? theme.colors.text)

/** Strip `var(--x, fallback)` down to the fallback, for renderers that do not understand CSS variables. */
export function resolveVars(css: string): string {
  let prev = ''
  let out = css
  while (out !== prev) {
    prev = out
    out = out.replace(/var\(\s*--[a-z0-9_-]+\s*,\s*((?:[^()]|\([^()]*\))*?)\s*\)/gi, '$1')
  }
  return out.replace(/var\(\s*--[a-z0-9_-]+\s*\)/gi, 'currentColor')
}

export interface RenderEnv {
  theme: Theme
  locale: string
  measure: Measure
  /** Maps: the viewer's camera, over the spec's. */
  camera?: Partial<import('./geo/view.js').Camera>
}
