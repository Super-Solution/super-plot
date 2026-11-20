// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
package superplot

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// Checks and descriptions of the gauge, the word cloud and the 3D charts, and the word cloud's layout. Every
// function mirrors one in packages/core/src/charts/gauge.ts, wordcloud.ts and plot3d.ts.

var checksMore = map[string]func(spec, []row, *[]Issue){
	"gauge":     checkGauge,
	"wordcloud": checkWordcloud,
	"scatter3d": checkScatter3d,
	"surface":   checkSurface,
}

var describersMore = map[string]func(spec) string{
	"gauge":     describeGauge,
	"wordcloud": describeWordcloud,
	"scatter3d": describeScatter3d,
	"surface":   describeSurface,
}

// --- gauge -----------------------------------------------------------------------------------------------

// maxGauges is the most gauges in one chart (one per row); the rest are left out with a warning.
const maxGauges = 6

type gaugeBand struct {
	name     string
	from, to float64
}

type gaugeItem struct {
	key                 string
	value, target       float64
	hasValue, hasTarget bool
	bands               []gaugeBand
}

type gaugeRange struct {
	min, max, largest float64
	derived, ok       bool
}

// gaugeItems is one gauge per row, at most maxGauges; a repeated label keeps its first row. Mirrors gaugeItems.
func gaugeItems(s spec, rows []row) (items []gaugeItem, extra, duplicates int, unordered []string) {
	names := columnList(s["bands"])
	label, named := s["label"].(string)
	seen := map[string]bool{}
	for i, r := range rows {
		// Without label (one row) the gauge is named by its value column.
		key := str(s, "value")
		if named {
			key = keyString(r[label])
		} else if i > 0 {
			key = fmt.Sprintf("%s %d", key, i+1)
		}
		if seen[key] {
			duplicates++
			continue
		}
		seen[key] = true
		if len(items) >= maxGauges {
			extra++
			continue
		}
		it := gaugeItem{key: key}
		rising := true
		for _, n := range names {
			if v, ok := toNumber(r[n]); ok {
				if k := len(it.bands); k > 0 && v < it.bands[k-1].to {
					rising = false
				}
				it.bands = append(it.bands, gaugeBand{name: n, to: v})
			}
		}
		if !rising {
			unordered = append(unordered, key)
		}
		sort.SliceStable(it.bands, func(a, b int) bool { return it.bands[a].to < it.bands[b].to })
		prev := math.Inf(-1)
		for j := range it.bands {
			it.bands[j].from = prev
			prev = it.bands[j].to
		}
		it.value, it.hasValue = toNumber(r[str(s, "value")])
		if t, ok := s["target"].(string); ok {
			it.target, it.hasTarget = toNumber(r[t])
		}
		items = append(items, it)
	}
	return items, extra, duplicates, unordered
}

// gaugeScale is the value range of every gauge: min (default 0) to max; without max, the top of
// NiceDomain(min, largest, 5), where largest is the largest value, target or threshold. Mirrors gaugeScale.
func gaugeScale(s spec, items []gaugeItem) gaugeRange {
	lo, _ := s["min"].(float64)
	largest, found := 0.0, false
	see := func(v float64, ok bool) {
		if ok && (!found || v > largest) {
			largest, found = v, true
		}
	}
	for _, it := range items {
		see(it.value, it.hasValue)
		see(it.target, it.hasTarget)
		for _, b := range it.bands {
			see(b.to, true)
		}
	}
	if hi, given := s["max"].(float64); given {
		return gaugeRange{min: lo, max: hi, largest: largest, ok: hi > lo}
	}
	if !found || largest <= lo {
		return gaugeRange{min: lo, max: lo, largest: largest, derived: true}
	}
	_, top := NiceDomain(lo, largest, 5)
	return gaugeRange{min: lo, max: top, largest: largest, derived: true, ok: true}
}

// bandOf is the first band whose threshold reaches v, if any.
func bandOf(it gaugeItem, v float64) (gaugeBand, bool) {
	for _, b := range it.bands {
		if v <= b.to {
			return b, true
		}
	}
	return gaugeBand{}, false
}

// shareOf is the share of the range the arc shows for v, clamped to 0..1.
func shareOf(v float64, sc gaugeRange) float64 {
	x := (v - sc.min) / (sc.max - sc.min)
	if x > 1 {
		return 1
	}
	if x <= 0 {
		return 0
	}
	return x
}

func checkGauge(s spec, rows []row, issues *[]Issue) {
	if _, named := s["label"].(string); len(rows) > 1 && !named {
		issue(issues, "error", "missing_required", "label", fmt.Sprintf("There are %d rows, so %d gauges: give `label`, the column that names each one.", len(rows), len(rows)), "Or filter to one row with `transform`.")
		return
	}
	lo, _ := s["min"].(float64)
	if hi, given := s["max"].(float64); given && hi <= lo {
		issue(issues, "error", "bad_range", "max", fmt.Sprintf("max (%s) must be above min (%s).", numberString(hi), numberString(lo)), "Set `min` too when the whole range is negative.")
		return
	}
	items, extra, duplicates, unordered := gaugeItems(s, rows)
	sc := gaugeScale(s, items)
	span := numberString(sc.min) + " to " + numberString(sc.max)
	if !sc.ok {
		issue(issues, "error", "max_required", "max", fmt.Sprintf("Every value is at or below min (%s), so no range can be derived.", numberString(sc.min)), "Give `max`: the capacity or goal the arc stands for.")
		return
	}
	if sc.derived {
		issue(issues, "warning", "max_derived", "max", fmt.Sprintf("No max was given; the arc ends at %s, rounded up from the largest value (%s). The share of the arc then says nothing about capacity or a goal.", numberString(sc.max), numberString(sc.largest)),
			"Set `max` to what a full arc means (100%, the capacity, the plan).")
	}
	if extra > 0 {
		issue(issues, "warning", "too_many_gauges", "data", fmt.Sprintf("%d gauges; only the first %d are drawn.", extra+maxGauges, maxGauges), "Use a bullet chart (`type: \"bullet\"`) to compare many measures, or filter with `transform`.")
	}
	if duplicates > 0 {
		issue(issues, "warning", "duplicate_measures", "label", fmt.Sprintf("%d row(s) repeat a gauge label; only the first row of each is drawn.", duplicates))
	}
	if len(unordered) > 0 {
		var quoted []string
		for _, k := range unordered[:min(3, len(unordered))] {
			quoted = append(quoted, `"`+clip(k, 40)+`"`)
		}
		issue(issues, "warning", "bands_not_increasing", "bands", fmt.Sprintf("The thresholds of %s do not increase in column order; they were sorted (each band keeps its tone).", strings.Join(quoted, ", ")), "List band columns in order along the arc, each threshold higher than the one before.")
	}
	var out, tout []string
	for _, it := range items {
		if it.hasValue && (it.value < sc.min || it.value > sc.max) {
			out = append(out, fmt.Sprintf(`"%s" (%s)`, clip(it.key, 30), numberString(it.value)))
		}
		if it.hasTarget && (it.target < sc.min || it.target > sc.max) {
			tout = append(tout, `"`+clip(it.key, 30)+`"`)
		}
	}
	if len(out) > 0 {
		issue(issues, "warning", "value_outside_range", "value", fmt.Sprintf("%s %s outside %s: the arc is clamped (full or empty) and the number shows the true value.", fmtList(out, 3), plural(len(out), "is", "are"), span), "Widen `min`/`max` if the range is wrong.")
	}
	if len(tout) > 0 {
		issue(issues, "warning", "target_outside_range", "target", fmt.Sprintf("The target of %s is outside %s; its tick sits at the end of the arc.", fmtList(tout, 3), span))
	}
}

func describeGauge(s spec) string {
	items, extra, _, _ := gaugeItems(s, rowsOf(s))
	sc := gaugeScale(s, items)
	f := formatter(s)
	n := len(items)
	derived := ""
	if sc.derived {
		derived = " (the maximum was rounded up from the data, not given)"
	}
	t := fmt.Sprintf("%s %s on %s from %s to %s%s; a filled arc's length is the value's share of that range.", lead(s, "Gauge"), plural(n, "One value", fmt.Sprintf("%d values", n)), plural(n, "an arc", "arcs"), f(sc.min), f(sc.max), derived)
	for _, it := range items {
		name := clip(it.key, 30)
		if !it.hasValue {
			t += fmt.Sprintf(" %s: no value.", name)
			continue
		}
		t += fmt.Sprintf(" %s: %s", name, f(it.value))
		switch {
		case it.value > sc.max:
			t += fmt.Sprintf(", above the maximum of %s (the arc is full)", f(sc.max))
		case it.value < sc.min:
			t += fmt.Sprintf(", below the minimum of %s (the arc is empty)", f(sc.min))
		default:
			t += fmt.Sprintf(", %s of the range", FormatPercent(shareOf(it.value, sc), 1))
		}
		if len(it.bands) > 0 {
			if b, ok := bandOf(it, it.value); ok {
				span := "up to " + f(b.to)
				if !math.IsInf(b.from, -1) {
					span = f(b.from) + " to " + f(b.to)
				}
				t += fmt.Sprintf(", in band \"%s\" (%s)", clip(b.name, 30), span)
			} else {
				t += ", above every band"
			}
		}
		if it.hasTarget {
			t += ", target " + f(it.target)
		}
		t += "."
	}
	if extra > 0 {
		t += fmt.Sprintf(" %d more %s not drawn.", extra, plural(extra, "row is", "rows are"))
	}
	return t
}

// --- word cloud ------------------------------------------------------------------------------------------

// Limits of a word cloud: words drawn at most, and the font size floor and ceiling (px).
const (
	CloudMaxWords = 150
	CloudMinFont  = 10
	CloudMaxFont  = 64
	// cloudSpacing is the radial growth of the spiral, in pixels per turn.
	cloudSpacing = 4
	cloudCell    = 32
)

// cloudCos is cos(5k degrees) x 10000, rounded, for k = 0..18: the spiral's only trigonometry.
var cloudCos = [19]int64{10000, 9962, 9848, 9659, 9397, 9063, 8660, 8192, 7660, 7071, 6428, 5736, 5000, 4226, 3420, 2588, 1736, 872, 0}

// CloudWord is one word to place: its text, its font size in whole pixels, and whether it is turned 90 degrees.
type CloudWord struct {
	Text   string `json:"text"`
	Size   int    `json:"size"`
	Rotate bool   `json:"rotate"`
}

// CloudBox is a placed word's box, in whole pixels from the top left of the layout area (padding included).
type CloudBox struct {
	X      int  `json:"x"`
	Y      int  `json:"y"`
	W      int  `json:"w"`
	H      int  `json:"h"`
	Rotate bool `json:"rotate"`
}

// cos5 is cos(5k degrees) x 10000 for any integer k, from the quarter table.
func cos5(k int) int64 {
	q := ((k % 72) + 72) % 72
	switch {
	case q <= 18:
		return cloudCos[q]
	case q <= 36:
		return -cloudCos[36-q]
	case q <= 54:
		return -cloudCos[q-36]
	}
	return cloudCos[72-q]
}

// divRound is n / d rounded half away from zero, for d > 0.
func divRound(n, d int64) int64 {
	if n < 0 {
		return -((-2*n + d) / (2 * d))
	}
	return (2*n + d) / (2 * d)
}

// CloudLayout places words (largest first) on an Archimedean spiral without overlap. measure(text, size) is the
// width of a word's text. The result has, per word, its box, or nil when the word did not fit. Everything is
// integer arithmetic, so the boxes are the reference's exactly, given the same widths. Mirrors cloudLayout.
func CloudLayout(words []CloudWord, width, height float64, measure func(text string, size int) float64) []*CloudBox {
	W, H := int(math.Floor(width)), int(math.Floor(height))
	var placed []*CloudBox
	// A 32 px grid of placed boxes, only to find candidates faster; the result is the same as checking them all.
	grid := map[[2]int][]int{}
	cells := func(b *CloudBox, f func(key [2]int) bool) {
		for gx := b.X / cloudCell; gx <= (b.X+b.W-1)/cloudCell; gx++ {
			for gy := b.Y / cloudCell; gy <= (b.Y+b.H-1)/cloudCell; gy++ {
				if !f([2]int{gx, gy}) {
					return
				}
			}
		}
	}
	hits := func(b *CloudBox) bool {
		hit := false
		cells(b, func(key [2]int) bool {
			for _, i := range grid[key] {
				o := placed[i]
				if b.X < o.X+o.W && o.X < b.X+b.W && b.Y < o.Y+o.H && o.Y < b.Y+b.H {
					hit = true
					return false
				}
			}
			return true
		})
		return hit
	}
	steps := 0
	if H > 0 {
		steps = (72 * H) / cloudSpacing
	}
	out := make([]*CloudBox, len(words))
	for wi, word := range words {
		tw := int(math.Ceil(measure(word.Text, word.Size))) + 2
		th := word.Size + (word.Size+4)/5 + 2
		w, h := tw, th
		if word.Rotate {
			w, h = th, tw
		}
		if w > W || h > H || W <= 0 || H <= 0 {
			continue
		}
		for t := 0; t <= steps; t++ {
			k := t % 72
			dx := divRound(cloudSpacing*int64(t)*cos5(k)*int64(W), 72*10000*int64(H))
			dy := divRound(cloudSpacing*int64(t)*cos5(k-18), 72*10000)
			b := &CloudBox{X: W/2 + int(dx) - w/2, Y: H/2 + int(dy) - h/2, W: w, H: h, Rotate: word.Rotate}
			if b.X < 0 || b.Y < 0 || b.X+w > W || b.Y+h > H || hits(b) {
				continue
			}
			placed = append(placed, b)
			at := len(placed) - 1
			cells(b, func(key [2]int) bool {
				grid[key] = append(grid[key], at)
				return true
			})
			out[wi] = b
			break
		}
	}
	return out
}

type cloudEntry struct {
	text, series string
	value        float64
}

// cloudWords are the words of a cloud, largest first (ties in data order), at most CloudMaxWords; rows with
// the same text are summed. total counts the distinct words, skipped the rows with a value at or below zero.
// Mirrors cloudWords.
func cloudWords(s spec, rows []row) (words []*cloudEntry, total, skipped int) {
	sums := newOmap[*cloudEntry]()
	series, grouped := s["series"].(string)
	for _, r := range rows {
		text := ""
		if raw := r[str(s, "text")]; raw != nil {
			text = jsTrim(jsString(raw))
		}
		v, ok := toNumber(r[str(s, "value")])
		if text == "" || !ok {
			continue
		}
		if v <= 0 {
			skipped++
			continue
		}
		if e, found := sums.get(text); found {
			e.value += v
			continue
		}
		e := &cloudEntry{text: text, value: v}
		if grouped {
			e.series = orEmpty(r[series])
		}
		sums.set(text, e)
	}
	for _, e := range sums.values() {
		if e.value > 0 {
			words = append(words, e)
		}
	}
	sort.SliceStable(words, func(a, b int) bool { return words[a].value > words[b].value })
	total = len(words)
	return words[:min(CloudMaxWords, total)], total, skipped
}

func checkWordcloud(s spec, rows []row, issues *[]Issue) {
	words, total, skipped := cloudWords(s, rows)
	if len(words) == 0 {
		issue(issues, "error", "no_positive_values", "value", "No word has a positive value; a word cloud sizes words by value.", "Check the value and text columns, or the transform that produced them.")
		return
	}
	if on, _ := s["patterns"].(bool); on {
		issue(issues, "warning", "patterns_unsupported", "patterns", "A word cloud draws text, which has no fill to texture; patterns is ignored. Groups stay apart by the legend, the tooltip and the spoken label.")
	}
	if skipped > 0 {
		issue(issues, "warning", "nonpositive_values", "value", fmt.Sprintf("%d row(s) with a value at or below zero are left out; a font size cannot show them.", skipped))
	}
	if total > CloudMaxWords {
		issue(issues, "warning", "too_many_words", "text", fmt.Sprintf("%d distinct words; only the %d largest are drawn.", total, CloudMaxWords), "Keep the top words with a `top` transform step, or use a sorted bar chart.")
	}
}

func describeWordcloud(s spec) string {
	words, total, _ := cloudWords(s, rowsOf(s))
	f := formatter(s)
	t := fmt.Sprintf("%s %d %s sized by %s (font size grows with the square root of the value, so a word's area roughly follows it; a long word looks bigger than a short one of the same value).",
		lead(s, "Word cloud"), total, plural(total, "word", "words"), clip(str(s, "value"), 30))
	if total > len(words) {
		t += fmt.Sprintf(" Only the %d largest are drawn.", len(words))
	}
	top := words[:min(10, len(words))]
	listed := make([]string, len(top))
	for i, w := range top {
		listed[i] = clip(w.text, 30) + " " + f(w.value)
	}
	list := strings.Join(listed, ", ")
	switch {
	case len(words) == 1:
		t += fmt.Sprintf(" The word: %s.", list)
	case len(top) < len(words):
		t += fmt.Sprintf(" Top %d, largest first: %s.", len(top), list)
	default:
		t += fmt.Sprintf(" All words, largest first: %s.", list)
	}
	if series, grouped := s["series"].(string); grouped {
		col := clip(series, 30)
		names := make([]string, len(words))
		for i, w := range words {
			names[i] = w.series
		}
		groups := distinct(names)
		for i, g := range groups {
			if g == "" {
				groups[i] = "no " + col
			} else {
				groups[i] = clip(g, 30)
			}
		}
		t += fmt.Sprintf(" Coloured by %s: %s.", col, fmtList(groups, 5))
	}
	return t
}

// --- 3D charts -------------------------------------------------------------------------------------------

// maxSurfaceSide is the most distinct x (and y) values a surface takes.
const maxSurfaceSide = 200

func perspectiveNote(s spec, issues *[]Issue, alternative string) {
	if str(s, "projection") == "perspective" {
		issue(issues, "info", "perspective_3d", "projection", "Perspective draws nearer things larger and farther ones smaller, so sizes and distances on screen do not compare across depth; points can also hide behind others.",
			"Keep the default orthographic projection unless depth matters more than comparison. "+alternative)
		return
	}
	issue(issues, "info", "perspective_3d", "projection", "A 3D chart hides points behind others, and a position on screen mixes all three values: read exact values from the tooltip, the data table or the description.", alternative)
}

type point3 struct {
	x, y, z float64
	s, name string
}

// points3d are the rows with a numeric x, y and z (and a size at or above zero, when set). Mirrors points3d.
func points3d(s spec, rows []row) []point3 {
	var out []point3
	size, series, label := str(s, "size"), str(s, "series"), str(s, "label")
	for _, r := range rows {
		x, okX := toNumber(r[str(s, "x")])
		y, okY := toNumber(r[str(s, "y")])
		z, okZ := toNumber(r[str(s, "z")])
		if !okX || !okY || !okZ {
			continue
		}
		if size != "" {
			if v, ok := toNumber(r[size]); !ok || v < 0 {
				continue
			}
		}
		p := point3{x: x, y: y, z: z, s: str(s, "z")}
		if series != "" {
			p.s = orEmpty(r[series])
		}
		if label != "" {
			p.name = orEmpty(r[label])
		}
		out = append(out, p)
	}
	return out
}

func checkScatter3d(s spec, rows []row, issues *[]Issue) {
	perspectiveNote(s, issues, "For exact comparison show two of the measures in a scatter plot (colour or size for the third), or small multiples.")
	size := str(s, "size")
	if size != "" {
		neg := 0
		for _, r := range rows {
			if v, ok := toNumber(r[size]); ok && v < 0 {
				neg++
			}
		}
		if neg > 0 {
			issue(issues, "warning", "negative_skipped", "size", fmt.Sprintf("%d rows have a negative size and are skipped: an area cannot be negative.", neg))
		}
	}
	n := len(points3d(s, rows))
	if n == 0 {
		issue(issues, "error", "no_points", "data", "No row has a numeric x, y and z (and size, when set).")
	} else if n < len(rows) {
		orSize := ""
		if size != "" {
			orSize = " (or a size)"
		}
		issue(issues, "warning", "incomplete_rows", "data", fmt.Sprintf("%d of %d rows lack a numeric x, y or z%s and are left out.", len(rows)-n, len(rows), orSize))
	}
}

func describeScatter3d(s spec) string {
	pts := points3d(s, rowsOf(s))
	// format is for z, as on the axes and in the tooltips; x and y are given exactly.
	f, e := formatter(s), FormatExact
	if len(pts) == 0 {
		return lead(s, "3D scatter plot") + " No points."
	}
	xn, yn, zn := str(s, "x"), str(s, "y"), str(s, "z")
	var groups []string
	if str(s, "series") != "" {
		names := make([]string, len(pts))
		for i, p := range pts {
			names[i] = p.s
		}
		groups = distinct(names)
	}
	xs, ys, zs := make([]float64, len(pts)), make([]float64, len(pts)), make([]float64, len(pts))
	for i, p := range pts {
		xs[i], ys[i], zs[i] = p.x, p.y, p.z
	}
	x0, x1, _ := extent(xs)
	y0, y1, _ := extent(ys)
	z0, z1, _ := extent(zs)
	top := firstMax(pts, func(p point3) float64 { return p.z })
	low := firstMin(pts, func(p point3) float64 { return p.z })
	at := func(p point3) string {
		name := ""
		if p.name != "" {
			name = clip(p.name, 40) + ", "
		}
		return fmt.Sprintf("%s%s %s, %s %s", name, xn, e(p.x), yn, e(p.y))
	}
	sized, grouped := "", ""
	if size := str(s, "size"); size != "" {
		sized = ", sized by " + size
	}
	if len(groups) > 1 {
		grouped = fmt.Sprintf(", in %d groups (%s)", len(groups), fmtList(groups, 5))
	}
	return fmt.Sprintf("%s %d points of %s against %s and %s%s%s. %s ranges from %s to %s, %s from %s to %s and %s from %s to %s. Highest %s: %s (%s). Lowest: %s (%s).",
		lead(s, "3D scatter plot"), len(pts), zn, xn, yn, sized, grouped, xn, e(x0), e(x1), yn, e(y0), e(y1), zn, f(z0), f(z1), zn, f(top.z), at(top), f(low.z), at(low))
}

type surfaceGrid struct {
	xs, ys  []float64
	cells   map[[2]int]float64 // (x index, y index) to the first z given for that cell
	repeats int                // rows that repeat a cell already given
	missing [][2]float64       // cells of the full grid that have no value, in x then y order
}

// gridOf is the grid of a surface: its distinct x and y values (ascending), the first z of each cell, the
// repeats and the holes. Mirrors gridOf.
func gridOf(s spec, rows []row) surfaceGrid {
	var pts [][3]float64
	seenX, seenY := map[float64]bool{}, map[float64]bool{}
	g := surfaceGrid{cells: map[[2]int]float64{}}
	for _, r := range rows {
		x, okX := toNumber(r[str(s, "x")])
		y, okY := toNumber(r[str(s, "y")])
		z, okZ := toNumber(r[str(s, "z")])
		if !okX || !okY || !okZ {
			continue
		}
		// A JavaScript Set keeps minus zero as zero.
		if x == 0 {
			x = 0
		}
		if y == 0 {
			y = 0
		}
		pts = append(pts, [3]float64{x, y, z})
		if !seenX[x] {
			seenX[x] = true
			g.xs = append(g.xs, x)
		}
		if !seenY[y] {
			seenY[y] = true
			g.ys = append(g.ys, y)
		}
	}
	sort.Float64s(g.xs)
	sort.Float64s(g.ys)
	xi, yi := make(map[float64]int, len(g.xs)), make(map[float64]int, len(g.ys))
	for i, v := range g.xs {
		xi[v] = i
	}
	for i, v := range g.ys {
		yi[v] = i
	}
	for _, p := range pts {
		k := [2]int{xi[p[0]], yi[p[1]]}
		if _, given := g.cells[k]; given {
			g.repeats++
		} else {
			g.cells[k] = p[2]
		}
	}
	if len(g.xs) <= maxSurfaceSide && len(g.ys) <= maxSurfaceSide {
		for i := range g.xs {
			for j := range g.ys {
				if _, given := g.cells[[2]int{i, j}]; !given {
					g.missing = append(g.missing, [2]float64{g.xs[i], g.ys[j]})
				}
			}
		}
	}
	return g
}

func checkSurface(s spec, rows []row, issues *[]Issue) {
	perspectiveNote(s, issues, "For exact reading, a heatmap of z over x and y shows the same grid without depth.")
	g := gridOf(s, rows)
	if len(g.cells) == 0 {
		issue(issues, "error", "no_points", "data", "No row has a numeric x, y and z.")
		return
	}
	bad := false
	for _, side := range []struct {
		k string
		n int
	}{{"x", len(g.xs)}, {"y", len(g.ys)}} {
		if side.n < 2 {
			bad = true
			issue(issues, "error", "grid_too_small", side.k, fmt.Sprintf("%q has %d distinct value%s; a surface needs at least 2 for x and 2 for y.", str(s, side.k), side.n, plural(side.n, "", "s")), "For one row of values use a line chart.")
		} else if side.n > maxSurfaceSide {
			bad = true
			issue(issues, "error", "grid_too_large", side.k, fmt.Sprintf("%q has %d distinct values; a surface takes at most %d (a %d x %d grid).", str(s, side.k), side.n, maxSurfaceSide, maxSurfaceSide, maxSurfaceSide),
				fmt.Sprintf("Round or bin %s first (a bin step, then aggregate the mean of z per bin), or draw the rows as a scatter3d.", side.k))
		}
	}
	if bad {
		return
	}
	if g.repeats > 0 {
		issue(issues, "warning", "duplicate_cells", "data", fmt.Sprintf("%d rows repeat an (x, y) point already given; the first value is drawn.", g.repeats), "Aggregate first (for example the mean of z per x and y) if the repeats are measurements to combine.")
	}
	if len(g.missing) > 0 {
		total := len(g.xs) * len(g.ys)
		var eg []string
		for _, p := range g.missing[:min(3, len(g.missing))] {
			eg = append(eg, fmt.Sprintf("(%s, %s)", numberString(p[0]), numberString(p[1])))
		}
		hint := "Give one row for every combination of the x and y values to close the holes."
		if 2*len(g.cells) < total {
			hint = "Most of the grid is empty: this looks like scattered points rather than a grid. Use scatter3d, or bin x and y."
		}
		issue(issues, "warning", "missing_cells", "data", fmt.Sprintf("%d of %d grid points (%d x by %d y) have no z value and are drawn as holes, e.g. %s.", len(g.missing), total, len(g.xs), len(g.ys), fmtList(eg, 3)), hint)
	}
}

func describeSurface(s spec) string {
	g := gridOf(s, rowsOf(s))
	// format is for z, as on the axes and in the tooltips; x and y are given exactly.
	f, e := formatter(s), FormatExact
	if len(g.cells) == 0 {
		return lead(s, "Surface") + " No values."
	}
	xn, yn, zn := str(s, "x"), str(s, "y"), str(s, "z")
	var top, low [3]float64
	found := false
	for i := range g.xs {
		for j := range g.ys {
			z, given := g.cells[[2]int{i, j}]
			if !given {
				continue
			}
			if !found || z > top[2] {
				top = [3]float64{g.xs[i], g.ys[j], z}
			}
			if !found || z < low[2] {
				low = [3]float64{g.xs[i], g.ys[j], z}
			}
			found = true
		}
	}
	total := len(g.xs) * len(g.ys)
	missing := ""
	if len(g.cells) < total {
		missing = fmt.Sprintf(" (%d of %d points missing)", total-len(g.cells), total)
	}
	at := func(p [3]float64) string { return fmt.Sprintf("%s %s, %s %s", xn, e(p[0]), yn, e(p[1])) }
	return fmt.Sprintf("%s %s over a grid of %d %s by %d %s values%s, coloured by %s. %s ranges from %s to %s and %s from %s to %s. Highest %s: %s at %s. Lowest: %s at %s.",
		lead(s, "Surface"), zn, len(g.xs), xn, len(g.ys), yn, missing, zn, xn, e(g.xs[0]), e(g.xs[len(g.xs)-1]), yn, e(g.ys[0]), e(g.ys[len(g.ys)-1]), zn, f(top[2]), at(top), f(low[2]), at(low))
}
