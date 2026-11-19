# Round 5: the Go and Python ports

For the lead to fold into DESIGN.md and `ports/README.md` (already updated). Both ports now cover everything the
reference validates, transforms and describes as of the merge of wp8 (timeline, stream graph, `focus`).

## What was ported

| Area | Reference | Python | Go |
|---|---|---|---|
| Charts: violin, calendar, sunburst, parallel, waterfall, funnel, bullet, bump, waffle, beeswarm, timeline; box `points`; bar `mark: "lollipop"`; area `stack: "center"` | `charts/*.ts` | `charts.py` | `charts.go`, `charts_more.go` |
| Log axes, intervals, `gaps`, LOESS trend | `charts/extras.ts`, `series.ts`, `scatter.ts`, `bar.ts` | `charts.py` | `charts.go` |
| Field kinds: `flag`, `values` (`focus` on treemap and sunburst, with `focus_not_found` / `focus_leaf` and the "Showing only" sentence); `columns` with `min` / `max`; point annotations | `schema.ts` | `validate.py` | `validate.go` |
| Transform steps `bin`, `window`, `fold` | `transform.ts` | `transform.py` | `transform.go` |
| Statistics: `kde`, `silverman`, `densityPeaks`, `loess`, `logTicks`, `niceLogDomain`, `transformBinEdges`, `waffleCells`, `formatDuration` | `charts/violin.ts`, `util/loess.ts`, `scale.ts`, `util/bins.ts`, `charts/waffle.ts`, `util/time.ts` | `numeric.py`, `text.py` | `numeric.go`, `text.go` |
| `exp`, `log`, `log10`, `cbrt`, `**` as the reference's engine computes them | V8 `ieee754.cc` | `_fdlibm.py` | `fdlibm.go` |

Not ported, on purpose: the colour-vision check (`colors_indistinct`), `timeZone` and `strings`. They act when a
chart is compiled or rendered, not when a spec is validated; the ports' descriptions read dates in UTC.

## Decisions and findings

- **The elementary functions had to be reproduced bit for bit.** The violin's description says where a group is
  densest ("densest near 42"); the peak is whichever grid point has the highest density, and neighbouring points
  often differ in the last bit only. Python's `math` (glibc) and Go's `math` disagree with V8 in that last bit for
  a share of inputs: measured against Node 22 on random inputs, glibc differs for about 0.5% of `log10`, 50% of
  `cbrt` and 6% of `pow`. V8 does not call libm: it has its own port of fdlibm. Both ports now carry the same five
  functions, written from that source. Checked against Node on 480,000 inputs (Go) and 212,000 (Python): no
  difference.
- **V8's `pow` is not fdlibm's.** One line differs. fdlibm computes `r = (z*t1)/(t1-two) - (w + z*w)`; V8 has
  `r = (z*t1) / ((t1-two) - (w + z*w))`. A port of the original fdlibm matches Java's `StrictMath.pow` and
  differs from JavaScript for about 9% of inputs. The ports follow V8, with a comment on that line. It matters
  for `n ** -0.2` in Silverman's rule and `(1 - u*u*u) ** 3` in LOESS.
- **Go and fused multiply-add.** On arm64, ppc64 and s390x the Go compiler may turn `x*y + z` into one
  instruction that rounds once. `fdlibm.go` routes every product through `mul` (an explicit conversion, which
  the language specification says prevents fusion), and the new statistics do the same where a product meets a
  sum. Only amd64 was available to test on; the other architectures rely on that rule of the specification.
- **Annotations with a `null` field.** The ports used to let `"to": null`, `"tone": null` and `"label": null`
  pass on a reference line; the reference refuses them (`bad_type`, `bad_enum`). Found while porting the point
  form; the ports now refuse them too, and the fuzzer writes such annotations.
- **Minus zero.** `Intl` prints minus zero as `-0`, so a bullet chart with a value of 0 against a negative
  target reads "0 against -27 (-0% of target)". The fuzzer found the ports printing "0%". The ports now keep the
  sign, as the reference does. The wording is the reference's and is odd; if the owner would rather read "0%",
  the change belongs in `util/format.ts` (and then in both ports), with a conformance case.
- **Python and `-0` in JSON text.** `json.loads("-0")` is the integer 0 in Python, minus zero in JavaScript and
  Go. A spec with a literal `-0` (no decimal point) therefore formats as "0" in Python and "-0" elsewhere. Left
  as it is and written down in `ports/README.md`: fixing it means a custom number parser for every spec.
- **`describe` of an empty bump chart.** With no usable x value the reference prints "from  to " (it clips
  `undefined` to an empty string). The Python port raised on `None`; it now prints the same text.
- **Kept from before:** `uslice` drops a lone surrogate half where JavaScript would keep it.

## Fuzzing

`ports/fuzz/generate.mjs` now writes, per seed:

- about 70,650 numeric cases: the earlier ones plus 2,000 log axes (ticks and round ends), 250 kernel densities
  (bandwidth, grid, density and peaks), 400 LOESS fits, 600 bin steps, 600 waffles and 3,000 durations. They
  are compared for equality, not within a tolerance;
- 5,007 specs over all 27 chart types, picked evenly (about 185 each). Rows get the columns the new charts
  read (interval ends, ranks, a yes/no column, the two ends of a range), and each new type has its own fields,
  sound and wrong. Log axes, intervals, `gaps`, `mark`, `trend` and annotations of both forms are added where a
  chart takes them (and now and then where it does not); `focus` paths are mostly taken from a row of the data;
- transform pipelines with `bin`, `window` and `fold` next to the earlier steps, including steps wrong in every
  way the reference checks, and charts that read the column a step made (`key` / `value` after a fold, a running
  value after a window).

About 35% of the specs are valid (26% before), so more descriptions and transformed rows are compared.

No fault was found in the reference: every mismatch the fuzzer reported was the ports' (the minus zero above).

## For the owner to revisit

- "-0% of target" (above).
- Whether the ports should offer `describe` in a time zone. It needs the IANA database in each language
  (Go has `time/tzdata`, Python `zoneinfo`), and the conformance data has no case for it.

# Round 6: the Go and Python ports

Round 6 added four charts, two value-axis fields and one transform step to the reference. Both ports now replay
every conformance case and agree with the reference on every fuzzed case.

## What was ported

- **Charts.** `gauge` (items, the scale from `min` / `max` / the data, bands, target, the reading against a
  band), `wordcloud` (the words a cloud draws, their font sizes, and the layout itself), `scatter3d` and
  `surface` (points, the grid with its missing and repeated cells, `projection` and `camera`).
  Python: `charts_more.py`. Go: `charts_extra.go`.
- **A second value axis and a broken one.** `yRight`, `yRightLabel`, `rightDomain`, `formatRight` and `yBreak`
  on bar, line and area: the checks (`dual_axis`, `dual_axis_refused`, `dual_axis_ignored`, `dual_axis_overlap`,
  `right_axis_unused`, `axis_break`, `break_refused`, `break_misleading`, `break_hides_values`, `break_outside`)
  and the sentences they add to a description. Python: `charts.py`. Go: `valueaxes.go`.
- **The `index` step** of `transform`, with `index_group_dropped`.
- **A third severity.** `info` (`dual_axis`, `axis_break`, `perspective_3d`): a note, not a fault. A port already
  treated anything but `error` as passing, so only the documentation changed.
- **The camera of a 3D view.** The fields file now carries the camera's keys and limits per field (`keys`,
  `limits`), so one `camera` check serves the maps and the 3D charts.

Zoom and brush refusals and `transition` are decided when a chart is compiled or drawn; nothing in validate or
describe depends on them, so the ports have nothing to port there.

## Decisions and findings

- **The word cloud layout is integers only**, by design of the reference: the spiral reads cosines from a table
  of `cos(5k degrees) x 10000`, divides with one rounding rule (half away from zero) and tests boxes on a 32 px
  grid. The ports copy the table and the rule, so a layout is equal box for box and needs no tolerance. The one
  floating-point input is the text width, which the host supplies (`measure`) and the layout rounds up once.
- **The exact number format.** The 3D descriptions print a value with up to 10 decimals
  (`Intl.NumberFormat` with `maximumFractionDigits: 10`). `format_exact` / `FormatExact` start from the shortest
  text that reads back as the same double (Python's `repr`, Go's `strconv` with precision -1), round that
  decimal text half up at the tenth place and group the integer part. Rounding the text and not the double is
  what makes `0.30000000000000004` print as `0.3` and `5e-11` as `0.0000000001`, as the reference does.
- **Minus zero in a grid.** The reference collects a surface's x and y values in a `Set`, which stores `-0` as
  `0`. The ports normalise the sign when they collect the values; otherwise a grid starting at `-0` would count
  one value too many and describe itself from "-0".
- **`yBreak` leaves the normalized spec** when the break lies outside the values (`break_outside`): the
  reference deletes the field after warning, and so do the ports.
- **Index compares the base row as sort does**: by number or date when both cells read as one, otherwise as
  text, and an absent cell reads as the text "undefined". Each value is computed as `(v * base) / b`, in that
  order, which is the order the reference multiplies and divides in; the other order differs in the last bit.

## Fuzzing

`ports/fuzz/generate.mjs` now writes, per seed:

- 76,457 numeric cases: the earlier ones plus 5,507 exact number formats and 300 word cloud layouts (1 to 70
  words in areas from nothing to 750 x 530, some words rotated);
- 6,207 specs: 5,000 at random over all 31 chart types, with the new charts' fields sound and wrong, a camera
  and a projection on the 3D charts, `yRight` / `yBreak` and their companions on the charts that take them
  (and now and then on one that does not), and `index` among the transform steps; 700 bar, line and area charts
  that are mostly sound, written to reach every refusal and note of the two axis fields; 500 mostly sound
  gauges, word clouds and 3D charts, among them clouds at the word limit and grids at the size limit; and the 7
  size-limit maps from before.

| Seed | Numeric cases | Specs (valid) | Mismatches, Python | Mismatches, Go |
|---|---|---|---|---|
| 7 | 76,457 | 6,207 (2,230) | 0 | 0 |
| 2026 | 76,457 | 6,207 (2,210) | 0 | 0 |
| 90210 | 76,457 | 6,207 (2,197) | 0 | 0 |

On seed 7 the specs reach `dual_axis` 259 times, `break_refused` 183, `dual_axis_overlap` 57,
`dual_axis_ignored` 45, `axis_break` 44, `break_outside` 26, `break_misleading` 12, `break_hides_values` 11,
`perspective_3d` 314, `index_group_dropped` 280, `too_many_words` 28 and `grid_too_large` 26.

No fault was found in the reference. The one difference the fuzzer reported was in its own cases: JSON cannot
carry `-0`, so the exact-format case for it arrived as `0`; the case is now `-1e-11`, which rounds to "-0".
