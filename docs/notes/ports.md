# Round 5: the Go and Python ports

For the lead to fold into DESIGN.md and `ports/README.md` (already updated). Both ports now cover everything the
reference validates, transforms and describes as of the merge of wp7.

## What was ported

| Area | Reference | Python | Go |
|---|---|---|---|
| Charts: violin, calendar, sunburst, parallel, waterfall, funnel, bullet, bump, waffle, beeswarm, timeline; box `points`; bar `mark: "lollipop"`; area `stack: "center"` | `charts/*.ts` | `charts.py` | `charts.go`, `charts_more.go` |
| Log axes, intervals, `gaps`, LOESS trend | `charts/extras.ts`, `series.ts`, `scatter.ts`, `bar.ts` | `charts.py` | `charts.go` |
| Field kinds: `flag`; `columns` with `min` / `max`; point annotations | `schema.ts` | `validate.py` | `validate.go` |
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
  chart takes them (and now and then where it does not);
- transform pipelines with `bin`, `window` and `fold` next to the earlier steps, including steps wrong in every
  way the reference checks, and charts that read the column a step made (`key` / `value` after a fold, a running
  value after a window).

About 36% of the specs are valid (26% before), so more descriptions and transformed rows are compared.

No fault was found in the reference: every mismatch the fuzzer reported was the ports' (the minus zero above).

## For the owner to revisit

- "-0% of target" (above).
- Whether the ports should offer `describe` in a time zone. It needs the IANA database in each language
  (Go has `time/tzdata`, Python `zoneinfo`), and the conformance data has no case for it.
