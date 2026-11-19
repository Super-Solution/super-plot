package superplot

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// Per-chart rules the field definitions cannot express: cross-field checks and the plain-language description.
// Every function mirrors one in the reference implementation (packages/core/src/charts/*.ts); the conformance
// data in conformance/plot.v1.json keeps them in step.

const (
	maxAxes  = 16
	maxNodes = 40
	maxLinks = 300
)

type spec = map[string]any

var checks = map[string]func(spec, []row, *[]Issue){
	"bar":     checkBar,
	"line":    func(s spec, _ []row, i *[]Issue) { seriesIgnored(s, i) },
	"area":    func(s spec, _ []row, i *[]Issue) { seriesIgnored(s, i) },
	"scatter": checkScatter,
	"radar":   checkRadar,
	"treemap": checkTreemap,
	"sankey":  checkSankey,
}

var describers = map[string]func(spec) string{
	"bar":  describeBar,
	"line": func(s spec) string { return describeSeries(s, "Line chart") },
	"area": func(s spec) string {
		switch str(s, "stack") {
		case "normalize":
			return describeSeries(s, "Stacked area chart (100%)")
		case "stack":
			return describeSeries(s, "Stacked area chart")
		}
		return describeSeries(s, "Area chart")
	},
	"scatter":   describeScatter,
	"pie":       func(s spec) string { return describePie(s, "Pie chart") },
	"donut":     func(s spec) string { return describePie(s, "Donut chart") },
	"histogram": describeHistogram,
	"box":       describeBox,
	"heatmap":   describeHeatmap,
	"radar":     describeRadar,
	"treemap":   describeTreemap,
	"sankey":    describeSankey,
}

// --- small accessors over a normalised spec -------------------------------------------------------------

func str(s spec, k string) string { v, _ := s[k].(string); return v }

func columnList(v any) []string {
	switch x := v.(type) {
	case string:
		return []string{x}
	case []any:
		out := make([]string, len(x))
		for i, e := range x {
			out[i], _ = e.(string)
		}
		return out
	}
	return nil
}

func lead(s spec, kind string) string {
	if t := str(s, "title"); t != "" {
		return fmt.Sprintf("%s \"%s\".", kind, clip(t, 120))
	}
	return kind + "."
}

func fmtList(items []string, most int) string {
	if len(items) <= most {
		return strings.Join(items, ", ")
	}
	return fmt.Sprintf("%s and %d more", strings.Join(items[:most], ", "), len(items)-most)
}

func formatter(s spec) func(float64) string { return ValueFormatter(str(s, "format")) }

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

func issue(issues *[]Issue, severity, code, path, message string, hint ...string) {
	add(issues, severity, code, path, message, hint...)
}

func rowsOf(s spec) []row {
	list, _ := s["data"].([]any)
	out := make([]row, len(list))
	for i, r := range list {
		out[i], _ = r.(map[string]any)
	}
	return out
}

// firstMax is reduce((a, b) => b > a ? b : a): the first of equal maxima.
func firstMax[T any](items []T, key func(T) float64) T {
	best := items[0]
	for _, it := range items[1:] {
		if key(it) > key(best) {
			best = it
		}
	}
	return best
}

func firstMin[T any](items []T, key func(T) float64) T {
	best := items[0]
	for _, it := range items[1:] {
		if key(it) < key(best) {
			best = it
		}
	}
	return best
}

func values(rows []row, col string) []any {
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = r[col]
	}
	return out
}

// --- bar -------------------------------------------------------------------------------------------------

type barModel struct {
	cats, keys []string
	m          *omap[*omap[float64]]
}

func newBarModel(s spec, y []string) barModel {
	o := observations(rowsOf(s), str(s, "x"), y, str(s, "series"))
	m := matrix(o)
	cats, keys := make([]string, len(o)), make([]string, len(o))
	for i, ob := range o {
		cats[i], keys[i] = keyString(ob.x), ob.s
	}
	cats, keys = distinct(cats), distinct(keys)
	if sort_ := str(s, "sort"); sort_ != "" && sort_ != "none" {
		tot := func(k string) float64 {
			if row, ok := m.get(k); ok {
				return total(row.values())
			}
			return 0
		}
		sort.SliceStable(cats, func(i, j int) bool {
			if sort_ == "asc" {
				return tot(cats[i]) < tot(cats[j])
			}
			return tot(cats[i]) > tot(cats[j])
		})
	}
	return barModel{cats, keys, m}
}

func seriesIgnored(s spec, issues *[]Issue) {
	if y, ok := s["y"].([]any); ok && len(y) > 1 && str(s, "series") != "" {
		issue(issues, "warning", "series_ignored", "series", "`series` is ignored when `y` lists several columns.")
	}
}

func checkBar(s spec, rows []row, issues *[]Issue) {
	seriesIgnored(s, issues)
	if st := str(s, "stack"); st == "stack" || st == "normalize" {
		neg := false
		for _, r := range rows {
			for _, c := range columnList(s["y"]) {
				if f, ok := r[c].(float64); ok && f < 0 {
					neg = true
				}
			}
		}
		if neg {
			issue(issues, "warning", "negative_in_stack", "y", "Negative values in a stacked bar are stacked below the axis; check that is what you want.")
		}
	}
	if detectXKind("auto", values(rows, str(s, "x"))) == "time" && len(rows) > 60 {
		issue(issues, "warning", "prefer_line", "type", "Many bars over time: a line or area chart reads better.")
	}
}

func describeBar(s spec) string {
	mod := newBarModel(s, columnList(s["y"]))
	f := formatter(s)
	type tot struct {
		c string
		v float64
	}
	totals := make([]tot, len(mod.cats))
	for i, c := range mod.cats {
		v := 0.0
		if row, ok := mod.m.get(c); ok {
			v = total(row.values())
		}
		totals[i] = tot{c, v}
	}
	t := fmt.Sprintf("%s %d %s", lead(s, "Bar chart"), len(mod.cats), plural(len(mod.cats), "category", "categories"))
	if len(mod.keys) > 1 {
		extra := ""
		switch str(s, "stack") {
		case "stack":
			extra = ", stacked"
		case "normalize":
			extra = ", stacked to 100%"
		}
		t += fmt.Sprintf(", %d series (%s%s).", len(mod.keys), fmtList(mod.keys, 5), extra)
	} else {
		t += "."
	}
	if len(totals) > 0 {
		hi := firstMax(totals, func(x tot) float64 { return x.v })
		lo := firstMin(totals, func(x tot) float64 { return x.v })
		t += fmt.Sprintf(" Highest: %s (%s).", clip(hi.c, 40), f(hi.v))
		if len(totals) > 1 {
			t += fmt.Sprintf(" Lowest: %s (%s).", clip(lo.c, 40), f(lo.v))
		}
		sum := make([]float64, len(totals))
		for i, x := range totals {
			sum[i] = x.v
		}
		t += fmt.Sprintf(" Total: %s.", f(total(sum)))
	}
	return t
}

// --- line / area -----------------------------------------------------------------------------------------

func describeSeries(s spec, name string) string {
	o := observations(rowsOf(s), str(s, "x"), columnList(s["y"]), str(s, "series"))
	xs := make([]any, len(o))
	keysAll := make([]string, len(o))
	for i, ob := range o {
		xs[i], keysAll[i] = ob.x, ob.s
	}
	kind := detectXKind(str(s, "xType"), xs)
	keys := distinct(keysAll)
	f := formatter(s)
	xk := func(r any) (any, bool) {
		switch kind {
		case "category":
			return keyString(r), true
		case "time":
			t, ok := toTime(r)
			return t, ok
		}
		n, ok := toNumber(r)
		return n, ok
	}
	label := func(x any) string {
		if kind == "time" {
			return formatDate(x.(float64))
		}
		if str, ok := x.(string); ok {
			return str
		}
		return numberString(x.(float64))
	}
	over := "a numeric x axis"
	switch kind {
	case "category":
		over = "categories"
	case "time":
		over = "time"
	}
	listed := ""
	if len(keys) > 1 {
		listed = fmt.Sprintf(" (%s)", fmtList(keys, 5))
	}
	t := fmt.Sprintf("%s %d series%s over %s.", lead(s, name), len(keys), listed, over)
	type pt struct {
		x any
		y float64
	}
	for _, k := range keys[:min(4, len(keys))] {
		var pts []pt
		for _, ob := range o {
			if ob.s != k || !ob.hasY {
				continue
			}
			if x, ok := xk(ob.x); ok {
				pts = append(pts, pt{x, ob.y})
			}
		}
		if kind != "category" {
			sort.SliceStable(pts, func(i, j int) bool { return pts[i].x.(float64) < pts[j].x.(float64) })
		}
		if len(pts) == 0 {
			continue
		}
		first, last := pts[0], pts[len(pts)-1]
		hi := firstMax(pts, func(p pt) float64 { return p.y })
		lo := firstMin(pts, func(p pt) float64 { return p.y })
		change := ""
		if first.y != 0 && len(pts) > 1 {
			change = fmt.Sprintf(" (%s%%)", toFixed(((last.y-first.y)/math.Abs(first.y))*100, 1))
		}
		t += fmt.Sprintf(" %s: from %s at %s to %s at %s%s; peak %s at %s, low %s at %s.", clip(k, 40), f(first.y), label(first.x), f(last.y), label(last.x), change, f(hi.y), label(hi.x), f(lo.y), label(lo.x))
	}
	return t
}

// --- scatter ---------------------------------------------------------------------------------------------

type spt struct {
	x, y float64
	s    string
}

func scatterPoints(s spec, rows []row) []spt {
	xc, yc := str(s, "x"), str(s, "y")
	kind := "linear"
	switch str(s, "xType") {
	case "time":
		kind = "time"
	case "linear":
	default:
		for _, r := range rows {
			if v, ok := r[xc].(string); ok {
				if _, isNum := toNumber(v); !isNum {
					kind = "time"
					break
				}
			}
		}
	}
	var pts []spt
	for _, r := range rows {
		var x float64
		var xok bool
		if kind == "time" {
			x, xok = toTime(r[xc])
		} else {
			x, xok = toNumber(r[xc])
		}
		y, yok := toNumber(r[yc])
		if !xok || !yok {
			continue
		}
		sk := yc
		if sc := str(s, "series"); sc != "" {
			sk = orEmpty(r[sc])
		}
		pts = append(pts, spt{x, y, sk})
	}
	return pts
}

func checkScatter(s spec, rows []row, issues *[]Issue) {
	if len(scatterPoints(s, rows)) == 0 {
		issue(issues, "error", "no_points", "data", "No row has both a numeric x and y.")
	}
}

func describeScatter(s spec) string {
	pts := scatterPoints(s, rowsOf(s))
	f := formatter(s)
	names := make([]string, len(pts))
	xs, ys := make([]float64, len(pts)), make([]float64, len(pts))
	for i, p := range pts {
		names[i], xs[i], ys[i] = p.s, p.x, p.y
	}
	keys := distinct(names)
	groups := ""
	if len(keys) > 1 {
		groups = fmt.Sprintf(", in %d groups (%s)", len(keys), strings.Join(keys[:min(5, len(keys))], ", "))
	}
	t := fmt.Sprintf("%s %d points of %s against %s%s.", lead(s, "Scatter plot"), len(pts), str(s, "y"), str(s, "x"), groups)
	if r, ok := correlation(xs, ys); ok {
		strength := "weak"
		if a := math.Abs(r); a >= 0.7 {
			strength = "strong"
		} else if a >= 0.4 {
			strength = "moderate"
		}
		dir := "negative"
		if r >= 0 {
			dir = "positive"
		}
		t += fmt.Sprintf(" Correlation %s (%s %s).", toFixed(r, 2), strength, dir)
	}
	if lo, hi, ok := extent(ys); ok {
		t += fmt.Sprintf(" %s ranges from %s to %s.", str(s, "y"), f(lo), f(hi))
	}
	return t
}

// --- pie / donut -----------------------------------------------------------------------------------------

type slice struct {
	key   string
	value float64
}

func pieSlices(s spec) []slice {
	rows := rowsOf(s)
	sums := newOmap[float64]()
	labels := make([]string, len(rows))
	for i, r := range rows {
		k := orEmpty(r[str(s, "label")])
		labels[i] = k
		v, ok := toNumber(r[str(s, "value")])
		if !ok || v < 0 {
			continue
		}
		cur, _ := sums.get(k)
		sums.set(k, cur+v)
	}
	var all []slice
	for _, k := range distinct(labels) {
		if v, ok := sums.get(k); ok {
			all = append(all, slice{k, v})
		}
	}
	if so := str(s, "sort"); so != "" && so != "none" {
		sort.SliceStable(all, func(i, j int) bool {
			if so == "asc" {
				return all[i].value < all[j].value
			}
			return all[i].value > all[j].value
		})
	}
	limit := 8
	if m, ok := s["maxSlices"].(float64); ok {
		limit = int(m)
	}
	if len(all) > limit {
		byValue := append([]slice(nil), all...)
		sort.SliceStable(byValue, func(i, j int) bool { return byValue[i].value > byValue[j].value })
		keep := map[string]bool{}
		for _, sl := range byValue[:limit-1] {
			keep[sl.key] = true
		}
		var kept []slice
		var rest []float64
		for _, sl := range all {
			if keep[sl.key] {
				kept = append(kept, sl)
			} else {
				rest = append(rest, sl.value)
			}
		}
		all = append(kept, slice{"Other", total(rest)})
	}
	return all
}

func describePie(s spec, name string) string {
	all := pieSlices(s)
	vals := make([]float64, len(all))
	for i, a := range all {
		vals[i] = a.value
	}
	tot := total(vals)
	f := formatter(s)
	t := fmt.Sprintf("%s %d %s totalling %s.", lead(s, name), len(all), plural(len(all), "slice", "slices"), f(tot))
	if tot > 0 {
		sorted := append([]slice(nil), all...)
		sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].value > sorted[j].value })
		t += fmt.Sprintf(" Largest: %s (%s).", clip(sorted[0].key, 40), FormatPercent(sorted[0].value/tot, 1))
		if len(sorted) > 2 {
			top := sorted[:3]
			names := make([]string, 3)
			tv := make([]float64, 3)
			for i, x := range top {
				names[i], tv[i] = clip(x.key, 30), x.value
			}
			t += fmt.Sprintf(" The top %d (%s) make up %s.", min(3, len(sorted)), fmtList(names, 3), FormatPercent(total(tv)/tot, 1))
		}
	}
	return t
}

// --- histogram / box -------------------------------------------------------------------------------------

func groupValues(s spec, valueCol, groupCol string) *omap[[]float64] {
	g := newOmap[[]float64]()
	for _, r := range rowsOf(s) {
		v, ok := toNumber(r[str(s, valueCol)])
		if !ok {
			continue
		}
		k := str(s, valueCol)
		if groupCol != "" && str(s, groupCol) != "" {
			k = orEmpty(r[str(s, groupCol)])
		}
		cur, _ := g.get(k)
		g.set(k, append(cur, v))
	}
	return g
}

func describeHistogram(s spec) string {
	g := groupValues(s, "value", "series")
	var all []float64
	for _, k := range g.keys {
		all = append(all, g.m[k]...)
	}
	f := ValueFormatter("auto")
	if len(all) == 0 {
		return lead(s, "Histogram") + " No numeric values."
	}
	bins := 0
	if b, ok := s["bins"].(float64); ok {
		bins = int(b)
	}
	width, _ := s["binWidth"].(float64)
	edges := BinEdges(all, bins, width)
	counts := BinCounts(all, edges)
	peak := 0
	for i, c := range counts {
		if c > counts[peak] {
			peak = i
		}
	}
	srt := append([]float64(nil), all...)
	sort.Float64s(srt)
	t := fmt.Sprintf("%s %d values of %s in %d bins of width %s. Mean %s, median %s, range %s to %s. Most common bin: %s to %s (%d values).",
		lead(s, "Histogram"), len(all), str(s, "value"), len(counts), f(edges[1]-edges[0]), f(mean(all)), f(Quantile(srt, 0.5)), f(srt[0]), f(srt[len(srt)-1]), f(edges[peak]), f(edges[peak+1]), counts[peak])
	if len(g.keys) > 1 {
		t += fmt.Sprintf(" Groups: %s.", fmtList(g.keys, 5))
	}
	return t
}

func describeBox(s spec) string {
	g := newOmap[[]float64]()
	for _, r := range rowsOf(s) {
		v, ok := toNumber(r[str(s, "y")])
		if !ok {
			continue
		}
		k := str(s, "y")
		if str(s, "x") != "" {
			k = orEmpty(r[str(s, "x")])
		}
		cur, _ := g.get(k)
		g.set(k, append(cur, v))
	}
	f := formatter(s)
	groups := ""
	if str(s, "x") != "" {
		groups = fmt.Sprintf(" for %d groups (%s)", len(g.keys), fmtList(g.keys, 5))
	}
	t := fmt.Sprintf("%s Distribution of %s%s.", lead(s, "Box plot"), str(s, "y"), groups)
	for _, k := range g.keys[:min(6, len(g.keys))] {
		st, ok := ComputeBoxStats(g.m[k])
		if !ok {
			continue
		}
		out := ""
		if n := len(st.Outliers); n > 0 {
			out = fmt.Sprintf(", %d outlier%s", n, map[bool]string{true: "s", false: ""}[n > 1])
		}
		t += fmt.Sprintf(" %s: median %s, middle half %s to %s, range %s to %s%s.", clip(k, 30), f(st.Median), f(st.Q1), f(st.Q3), f(st.Min), f(st.Max), out)
	}
	return t
}

// --- heatmap ---------------------------------------------------------------------------------------------

func describeHeatmap(s spec) string {
	rows := rowsOf(s)
	sums := newOmap[float64]()
	xsAll, ysAll := make([]string, len(rows)), make([]string, len(rows))
	for i, r := range rows {
		x, y := orEmpty(r[str(s, "x")]), orEmpty(r[str(s, "y")])
		xsAll[i], ysAll[i] = x, y
		v, ok := toNumber(r[str(s, "value")])
		if !ok {
			continue
		}
		k := x + "\x00" + y
		cur, _ := sums.get(k)
		sums.set(k, cur+v)
	}
	type cell struct {
		x, y string
		v    float64
	}
	cells := make([]cell, len(sums.keys))
	for i, k := range sums.keys {
		parts := strings.Split(k, "\x00")
		c := cell{x: parts[0], v: sums.m[k]}
		if len(parts) > 1 {
			c.y = parts[1]
		}
		cells[i] = c
	}
	f := formatter(s)
	if len(cells) == 0 {
		return lead(s, "Heatmap") + " No numeric cells."
	}
	hi := firstMax(cells, func(c cell) float64 { return c.v })
	lo := firstMin(cells, func(c cell) float64 { return c.v })
	return fmt.Sprintf("%s %d cells, %d columns by %d rows, coloured by %s. Highest: %s / %s (%s). Lowest: %s / %s (%s).",
		lead(s, "Heatmap"), len(cells), len(distinct(xsAll)), len(distinct(ysAll)), str(s, "value"), clip(hi.x, 30), clip(hi.y, 30), f(hi.v), clip(lo.x, 30), clip(lo.y, 30), f(lo.v))
}

// --- radar -----------------------------------------------------------------------------------------------

func radarModel(s spec) ([]string, []string, *omap[*omap[float64]]) {
	o := observations(rowsOf(s), str(s, "x"), columnList(s["y"]), str(s, "series"))
	axes, keys := make([]string, len(o)), make([]string, len(o))
	for i, ob := range o {
		axes[i], keys[i] = keyString(ob.x), ob.s
	}
	return distinct(axes), distinct(keys), matrix(o)
}

func checkRadar(s spec, rows []row, issues *[]Issue) {
	names := make([]string, len(rows))
	for i, r := range rows {
		names[i] = keyString(r[str(s, "x")])
	}
	axes := distinct(names)
	x := str(s, "x")
	if len(axes) < 3 {
		issue(issues, "error", "too_few_axes", "x", fmt.Sprintf("A radar chart needs at least 3 spokes; %q has %d distinct value(s).", x, len(axes)), "Use a bar chart for fewer measures.")
	}
	if len(axes) > maxAxes {
		issue(issues, "error", "too_many_axes", "x", fmt.Sprintf("A radar chart can show at most %d spokes; %q has %d.", maxAxes, x, len(axes)), "Group measures, or use a heatmap or bar chart.")
	}
	if detectXKind("auto", values(rows, x)) == "time" {
		issue(issues, "warning", "prefer_line", "type", "Spokes look like dates: a line chart shows change over time better.")
	}
}

func describeRadar(s spec) string {
	axes, keys, m := radarModel(s)
	f := formatter(s)
	t := fmt.Sprintf("%s %d spokes (%s), %d %s (%s).", lead(s, "Radar chart"), len(axes), fmtList(axes, 6), len(keys), plural(len(keys), "shape", "shapes"), fmtList(keys, 5))
	type pair struct {
		a string
		v float64
	}
	for _, k := range keys[:min(3, len(keys))] {
		pairs := make([]pair, len(axes))
		for i, a := range axes {
			v := 0.0
			if row, ok := m.get(a); ok {
				v, _ = row.get(k)
			}
			pairs[i] = pair{a, v}
		}
		hi := firstMax(pairs, func(p pair) float64 { return p.v })
		lo := firstMin(pairs, func(p pair) float64 { return p.v })
		t += fmt.Sprintf(" %s: highest %s (%s), lowest %s (%s).", clip(k, 30), clip(hi.a, 30), f(hi.v), clip(lo.a, 30), f(lo.v))
	}
	return t
}

// --- treemap ---------------------------------------------------------------------------------------------

type tile struct {
	label, group string
	value        float64
}

func treemapTiles(s spec) []*tile {
	sums := newOmap[*tile]()
	for _, r := range rowsOf(s) {
		v, ok := toNumber(r[str(s, "value")])
		if !ok || v <= 0 {
			continue
		}
		group := ""
		if gc := str(s, "group"); gc != "" {
			group = orEmpty(r[gc])
		}
		label := orEmpty(r[str(s, "label")])
		k := group + "\x00" + label
		if t, ok := sums.get(k); ok {
			t.value += v
		} else {
			sums.set(k, &tile{label, group, v})
		}
	}
	return sums.values()
}

func checkTreemap(s spec, rows []row, issues *[]Issue) {
	neg := 0
	for _, r := range rows {
		if f, ok := r[str(s, "value")].(float64); ok && f <= 0 {
			neg++
		}
	}
	if neg > 0 {
		issue(issues, "warning", "negative_slices", "value", fmt.Sprintf("%d zero or negative value(s) will be skipped; area cannot be negative.", neg))
	}
	if g := str(s, "group"); g != "" && g == str(s, "label") {
		issue(issues, "warning", "redundant_group", "group", "`group` is the same column as `label`.")
	}
}

func describeTreemap(s spec) string {
	ts := treemapTiles(s)
	f := formatter(s)
	vals := make([]float64, len(ts))
	for i, t := range ts {
		vals[i] = t.value
	}
	tot := total(vals)
	if len(ts) == 0 {
		return lead(s, "Treemap") + " No positive values."
	}
	var groups []string
	if str(s, "group") != "" {
		names := make([]string, len(ts))
		for i, t := range ts {
			names[i] = t.group
		}
		groups = distinct(names)
	}
	extra := ""
	if len(groups) > 0 {
		extra = fmt.Sprintf(" in %d groups (%s)", len(groups), fmtList(groups, 5))
	}
	t := fmt.Sprintf("%s %d tiles totalling %s%s.", lead(s, "Treemap"), len(ts), f(tot), extra)
	sorted := append([]*tile(nil), ts...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].value > sorted[j].value })
	t += fmt.Sprintf(" Largest: %s (%s).", clip(sorted[0].label, 40), FormatPercent(sorted[0].value/tot, 1))
	if len(groups) > 0 {
		type gv struct {
			g string
			v float64
		}
		gs := make([]gv, len(groups))
		for i, g := range groups {
			var part []float64
			for _, x := range ts {
				if x.group == g {
					part = append(part, x.value)
				}
			}
			gs[i] = gv{g, total(part)}
		}
		sort.SliceStable(gs, func(i, j int) bool { return gs[i].v > gs[j].v })
		t += fmt.Sprintf(" Largest group: %s (%s).", clip(gs[0].g, 40), FormatPercent(gs[0].v/tot, 1))
	}
	return t
}

// --- sankey ----------------------------------------------------------------------------------------------

type link struct {
	source, target string
	value          float64
}

func sankeyLinks(s spec) []*link {
	sums := newOmap[*link]()
	for _, r := range rowsOf(s) {
		v, ok := toNumber(r[str(s, "value")])
		if !ok || v <= 0 {
			continue
		}
		src, dst := orEmpty(r[str(s, "from")]), orEmpty(r[str(s, "to")])
		if src == dst {
			continue
		}
		k := src + "\x00" + dst
		if l, ok := sums.get(k); ok {
			l.value += v
		} else {
			sums.set(k, &link{src, dst, v})
		}
	}
	return sums.values()
}

// cycleOf returns the names on a cycle, or nil when the flows only go forward (iterative depth-first search).
func cycleOf(flows [][2]string) []string {
	out := newOmap[[]string]()
	for _, l := range flows {
		cur, _ := out.get(l[0])
		out.set(l[0], append(cur, l[1]))
	}
	state := map[string]int{}
	for _, start := range out.keys {
		if _, seen := state[start]; seen {
			continue
		}
		path := []string{start}
		state[start] = 1
		type frame struct {
			next []string
			i    int
		}
		stack := []*frame{{next: out.m[start]}}
		for len(stack) > 0 {
			top := stack[len(stack)-1]
			if top.i >= len(top.next) {
				state[path[len(path)-1]] = 2
				path = path[:len(path)-1]
				stack = stack[:len(stack)-1]
				continue
			}
			n := top.next[top.i]
			top.i++
			if state[n] == 1 {
				for i, p := range path {
					if p == n {
						return append(append([]string(nil), path[i:]...), n)
					}
				}
			}
			if _, seen := state[n]; !seen {
				state[n] = 1
				path = append(path, n)
				stack = append(stack, &frame{next: out.m[n]})
			}
		}
	}
	return nil
}

func checkSankey(s spec, rows []row, issues *[]Issue) {
	var flows [][2]string
	for _, r := range rows {
		if f, ok := r[str(s, "value")].(float64); ok && !(f > 0) {
			continue
		}
		src, dst := orEmpty(r[str(s, "from")]), orEmpty(r[str(s, "to")])
		if src != dst {
			flows = append(flows, [2]string{src, dst})
		}
	}
	nodes := map[string]bool{}
	links := map[string]bool{}
	for _, l := range flows {
		nodes[l[0]], nodes[l[1]] = true, true
		links[l[0]+"\x00"+l[1]] = true
	}
	if len(flows) != len(rows) {
		issue(issues, "warning", "flows_skipped", "value", "Flows with zero or negative value, or that start and end at the same node, are skipped.")
	}
	if len(nodes) > maxNodes {
		issue(issues, "error", "too_many_nodes", "from", fmt.Sprintf("A sankey diagram can show at most %d nodes; this has %d.", maxNodes, len(nodes)), `Merge small nodes into "Other".`)
	}
	if len(links) > maxLinks {
		issue(issues, "error", "too_many_links", "data", fmt.Sprintf("A sankey diagram can show at most %d flows.", maxLinks))
	}
	if loop := cycleOf(flows); loop != nil {
		issue(issues, "error", "cyclic_flow", "to", fmt.Sprintf("Flows form a loop: %s.", strings.Join(loop[:min(6, len(loop))], " → ")), "A sankey diagram needs flows that only go forward. Break the loop.")
	}
}

func describeSankey(s spec) string {
	ls := sankeyLinks(s)
	f := formatter(s)
	if len(ls) == 0 {
		return lead(s, "Sankey diagram") + " No positive flows."
	}
	type node struct{ in, out float64 }
	nodes := newOmap[*node]()
	get := func(k string) *node {
		n, ok := nodes.get(k)
		if !ok {
			n = &node{}
			nodes.set(k, n)
		}
		return n
	}
	for _, l := range ls {
		get(l.source).out += l.value
		get(l.target).in += l.value
	}
	var sources, sinks []string
	isSource := map[string]bool{}
	for _, k := range nodes.keys {
		n := nodes.m[k]
		if n.in == 0 {
			sources = append(sources, k)
			isSource[k] = true
		}
		if n.out == 0 {
			sinks = append(sinks, k)
		}
	}
	var entering []float64
	for _, l := range ls {
		if isSource[l.source] {
			entering = append(entering, l.value)
		}
	}
	big := firstMax(ls, func(l *link) float64 { return l.value })
	return fmt.Sprintf("%s %d nodes, %d flows; %s enters from %s and ends in %s. Largest flow: %s to %s (%s).",
		lead(s, "Sankey diagram"), len(nodes.keys), len(ls), f(total(entering)), fmtList(sources, 4), fmtList(sinks, 4), clip(big.source, 30), clip(big.target, 30), f(big.value))
}
