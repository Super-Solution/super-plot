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

	maxStages        = 40
	maxCalendarYears = 5
	maxChildren      = 30
	maxLines         = 2000
)

var weekdays = []string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}

type spec = map[string]any

var checks = map[string]func(spec, []row, *[]Issue){
	"bar":       checkBar,
	"line":      func(s spec, r []row, i *[]Issue) { checkSeries(s, r, i, false) },
	"area":      func(s spec, r []row, i *[]Issue) { checkSeries(s, r, i, true) },
	"scatter":   checkScatter,
	"histogram": func(s spec, _ []row, i *[]Issue) { refuseLog(s, i, "yScale") },
	"box":       checkPoints,
	"violin":    checkViolin,
	"calendar":  checkCalendar,
	"waterfall": checkWaterfall,
	"bullet":    checkBullet,
	"bump":      checkBump,
	"sunburst":  checkSunburst,
	"parallel":  checkParallel,
	"funnel":    checkFunnel,
	"waffle":    checkWaffle,
	"beeswarm":  checkBeeswarm,
	"radar":     checkRadar,
	"treemap":   checkTreemap,
	"sankey":    checkSankey,
}

// mapChecks are the checks of the map charts: they also get the geography that geo resolved to (nil without geo).
var mapChecks = map[string]func(spec, []row, *[]Issue, *geography){
	"choropleth": checkChoropleth,
	"bubble-map": checkBubbleMap,
	"column-map": checkColumnMap,
	"flow-map":   checkFlowMap,
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
	"scatter":    describeScatter,
	"pie":        func(s spec) string { return describePie(s, "Pie chart") },
	"donut":      func(s spec) string { return describePie(s, "Donut chart") },
	"histogram":  describeHistogram,
	"box":        describeBox,
	"violin":     describeViolin,
	"calendar":   describeCalendar,
	"waterfall":  describeWaterfall,
	"bullet":     describeBullet,
	"bump":       describeBump,
	"sunburst":   describeSunburst,
	"parallel":   describeParallel,
	"funnel":     describeFunnel,
	"waffle":     describeWaffle,
	"beeswarm":   describeBeeswarm,
	"heatmap":    describeHeatmap,
	"radar":      describeRadar,
	"treemap":    describeTreemap,
	"sankey":     describeSankey,
	"choropleth": describeChoropleth,
	"bubble-map": describeBubbleMap,
	"column-map": describeColumnMap,
	"flow-map":   describeFlowMap,
}

// --- small accessors over a normalised spec -------------------------------------------------------------

func has(s spec, k string) bool { _, ok := s[k]; return ok }

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

// pointNotes are the labelled point annotations, as one sentence for the description. Mirrors pointNotes.
func pointNotes(s spec) string {
	list, _ := s["annotations"].([]any)
	var items []string
	n := 0
	for _, item := range list {
		a, _ := item.(map[string]any)
		label, isStr := a["label"].(string)
		if _, line := a["axis"]; line || !isStr {
			continue
		}
		n++
		if n <= 5 {
			items = append(items, fmt.Sprintf("\"%s\" at %s, %s", clip(label, 40), clip(jsString(a["x"]), 30), clip(jsString(a["y"]), 30)))
		}
	}
	if n == 0 {
		return ""
	}
	more := ""
	if n > 5 {
		more = fmt.Sprintf(" and %d more", n-5)
	}
	return fmt.Sprintf(" Marked: %s%s.", strings.Join(items, "; "), more)
}

// --- log scales, intervals (packages/core/src/charts/extras.ts) -------------------------------------------

func refuseLog(s spec, issues *[]Issue, field string) {
	if str(s, field) == "log" {
		issue(issues, "error", "log_scale_refused", field, field+` "log" is refused here.`, "Use a line or a scatter for values spanning several orders of magnitude.")
	}
}

// logNonPositive reports values at or below zero in the columns behind a log axis: one issue with the count.
func logNonPositive(rows []row, cols []string, path string, issues *[]Issue) {
	bad, seen := 0, 0
	for _, r := range rows {
		for _, c := range cols {
			n, ok := toNumber(r[c])
			if !ok {
				continue
			}
			seen++
			if n <= 0 {
				bad++
			}
		}
	}
	switch {
	case bad == 0:
	case bad == seen:
		issue(issues, "error", "log_nonpositive", path, "Every value is zero or negative; a log axis cannot show any of them.", "Use the linear scale, or plot a positive quantity.")
	default:
		issue(issues, "warning", "log_nonpositive", path, fmt.Sprintf("%d of %d values are zero or negative; a log axis cannot place them, so they are left out.", bad, seen), "Filter them with `transform`, or use the linear scale.")
	}
}

func logDomain(s spec, issues *[]Issue, scaleField, domainField string) {
	d, _ := s[domainField].([]any)
	if str(s, scaleField) != "log" || len(d) != 2 {
		return
	}
	lo, loOK := d[0].(float64)
	hi, hiOK := d[1].(float64)
	if (loOK && lo <= 0) || (hiOK && hi <= 0) {
		issue(issues, "error", "log_bad_domain", domainField, domainField+" must be above zero on a log axis.", "Use a positive lower bound such as 1 or 0.1, or null for automatic.")
	}
}

// intervalCheck reports xLower without xUpper (or the other way round) and intervals whose ends are swapped; it
// is true when the spec has both ends.
func intervalCheck(s spec, rows []row, issues *[]Issue, axis string) bool {
	_, hasLo := s[axis+"Lower"]
	_, hasHi := s[axis+"Upper"]
	if !hasLo && !hasHi {
		return false
	}
	if !hasLo || !hasHi {
		missing := axis + "Upper"
		if !hasLo {
			missing = axis + "Lower"
		}
		issue(issues, "error", "interval_incomplete", missing, fmt.Sprintf("An interval needs both %sLower and %sUpper; %s is missing.", axis, axis, missing), "Give "+missing+" too.")
		return false
	}
	swapped := 0
	for _, r := range rows {
		a, aOK := toNumber(r[str(s, axis+"Lower")])
		b, bOK := toNumber(r[str(s, axis+"Upper")])
		if aOK && bOK && a > b {
			swapped++
		}
	}
	if swapped > 0 {
		issue(issues, "warning", "interval_reversed", axis+"Lower", fmt.Sprintf("In %d %s %sLower is above %sUpper; the interval is drawn between the two anyway.", swapped, plural(swapped, "row", "rows"), axis, axis))
	}
	return true
}

func stacked(s spec) bool { st := str(s, "stack"); return st == "stack" || st == "normalize" }

// --- bar -------------------------------------------------------------------------------------------------

type barModel struct {
	cats, keys []string
	m          *omap[*omap[float64]]
}

func newBarModel(s spec, y []string) barModel {
	o := observations(rowsOf(s), str(s, "x"), has(s, "x"), y, str(s, "series"))
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

// lineCols are the columns of a combo chart drawn as lines over vertical bars. Mirrors lineCols.
func lineCols(s spec) []string {
	if _, given := s["line"]; !given || str(s, "orientation") == "horizontal" || str(s, "stack") == "normalize" {
		return nil
	}
	return columnList(s["line"])
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
	if _, given := s["line"]; given && (str(s, "orientation") == "horizontal" || str(s, "stack") == "normalize") {
		on := "100% stacked"
		if str(s, "orientation") == "horizontal" {
			on = "horizontal"
		}
		issue(issues, "warning", "line_ignored", "line", fmt.Sprintf("`line` is ignored on %s bars.", on))
	}
	refuseLog(s, issues, "yScale")
	if str(s, "mark") == "lollipop" && stacked(s) {
		issue(issues, "warning", "lollipop_stacked", "mark", "Lollipops cannot stack; stacked bars are drawn instead.", `Set stack to "none" for side-by-side lollipops.`)
	}
	if intervalCheck(s, rows, issues, "y") && stacked(s) {
		issue(issues, "warning", "interval_ignored_stacked", "yLower", "Whiskers cannot be shown on stacked bars; they are left out.", `Set stack to "none" for grouped bars with whiskers.`)
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
	kind := "Bar chart"
	if str(s, "mark") == "lollipop" && !stacked(s) {
		kind = "Lollipop chart"
	}
	t := fmt.Sprintf("%s %d %s", lead(s, kind), len(mod.cats), plural(len(mod.cats), "category", "categories"))
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
	var ls []string
	for _, k := range lineCols(s) {
		if !contains(mod.keys, k) {
			ls = append(ls, k)
		}
	}
	if len(ls) > 0 {
		t += fmt.Sprintf(" With %s for %s on the same axis.", plural(len(ls), "a line", "lines"), fmtList(ls, 5))
	}
	if str(s, "yLower") != "" && str(s, "yUpper") != "" && !stacked(s) {
		t += fmt.Sprintf(" Whiskers show %s to %s.", clip(str(s, "yLower"), 40), clip(str(s, "yUpper"), 40))
	}
	return t
}

// --- line / area -----------------------------------------------------------------------------------------

func describeSeries(s spec, name string) string {
	o := observations(rowsOf(s), str(s, "x"), has(s, "x"), columnList(s["y"]), str(s, "series"))
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
			if str(s, "yScale") == "log" && !(ob.y > 0) {
				continue
			}
			if x, ok := xk(ob.x); ok {
				if n, isNum := x.(float64); str(s, "xScale") == "log" && kind == "linear" && isNum && !(n > 0) {
					continue
				}
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
	return t + seriesNotes(s)
}

// hasBand: shaded intervals behind lines, only with one y column and not on stacked areas.
func hasBand(s spec) bool {
	return str(s, "yLower") != "" && str(s, "yUpper") != "" && len(columnList(s["y"])) <= 1 && !stacked(s)
}

func joinAnd(items []string) (string, string) {
	if len(items) > 1 {
		return strings.Join(items, " and "), "are"
	}
	return strings.Join(items, " and "), "is"
}

// seriesNotes is one sentence on log axes and bands, for the description. Mirrors seriesNotes.
func seriesNotes(s spec) string {
	t := ""
	var axes []string
	for _, a := range []string{"y", "x"} {
		if str(s, a+"Scale") == "log" && str(s, "type") == "line" {
			axes = append(axes, a)
		}
	}
	if len(axes) > 0 {
		list, verb := joinAnd(axes)
		t += fmt.Sprintf(" The %s axis %s logarithmic.", list, verb)
	}
	if hasBand(s) {
		t += fmt.Sprintf(" A shaded band shows %s to %s.", clip(str(s, "yLower"), 40), clip(str(s, "yUpper"), 40))
	}
	return t
}

// checkSeries mirrors seriesCheck (line and area).
func checkSeries(s spec, rows []row, issues *[]Issue, area bool) {
	ys := columnList(s["y"])
	_, isList := s["y"].([]any)
	multi := isList && len(ys) > 1
	if multi && str(s, "series") != "" {
		issue(issues, "warning", "series_ignored", "series", "`series` is ignored when `y` lists several columns.")
	}
	if intervalCheck(s, rows, issues, "y") {
		if multi {
			issue(issues, "warning", "interval_needs_one_y", "yLower", "yLower and yUpper describe one column; with several `y` columns no band is drawn.", "Fold the columns into long form (a `fold` step) and use `series`.")
		} else if stacked(s) {
			issue(issues, "warning", "interval_ignored_stacked", "yLower", "An interval cannot be shown on a stacked area; no band is drawn.", `Set stack to "none", or use a line chart.`)
		}
	}
	if area {
		refuseLog(s, issues, "yScale")
		return
	}
	if str(s, "yScale") == "log" {
		logNonPositive(rows, ys, "y", issues)
		logDomain(s, issues, "yScale", "yDomain")
		if str(s, "gaps") == "zero" {
			issue(issues, "warning", "gaps_zero_log", "gaps", "A log axis has no zero, so missing values break the line instead.")
		}
	}
	if str(s, "xScale") == "log" {
		if detectXKind(str(s, "xType"), values(rows, str(s, "x"))) != "linear" {
			refuseLog(s, issues, "xScale")
		} else {
			logNonPositive(rows, []string{str(s, "x")}, "x", issues)
			logDomain(s, issues, "xScale", "xDomain")
		}
	}
}

// --- scatter ---------------------------------------------------------------------------------------------

type spt struct {
	x, y float64
	s    string
}

func scatterKind(s spec, rows []row) string {
	switch t := str(s, "xType"); t {
	case "time", "linear":
		return t
	}
	xc := str(s, "x")
	for _, r := range rows {
		if v, ok := r[xc].(string); ok {
			if _, isNum := toNumber(v); !isNum {
				return "time"
			}
		}
	}
	return "linear"
}

func scatterPoints(s spec, rows []row) []spt {
	xc, yc := str(s, "x"), str(s, "y")
	kind := scatterKind(s, rows)
	logX := str(s, "xScale") == "log" && kind == "linear"
	logY := str(s, "yScale") == "log"
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
		if !xok || !yok || (logX && !(x > 0)) || (logY && !(y > 0)) {
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
	kind := scatterKind(s, rows)
	if str(s, "xScale") == "log" && kind == "time" {
		refuseLog(s, issues, "xScale")
	}
	for _, a := range []string{"x", "y"} {
		if str(s, a+"Scale") != "log" || (a == "x" && kind == "time") {
			continue
		}
		logNonPositive(rows, []string{str(s, a)}, a, issues)
		logDomain(s, issues, a+"Scale", a+"Domain")
	}
	intervalCheck(s, rows, issues, "y")
	intervalCheck(s, rows, issues, "x")
	if has(s, "trendBandwidth") && str(s, "trend") != "loess" {
		issue(issues, "warning", "trend_bandwidth_ignored", "trendBandwidth", "trendBandwidth only applies to `trend: \"loess\"`; it is ignored.")
	}
	if anyError(*issues) {
		return
	}
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
	var logs, bars []string
	if str(s, "xScale") == "log" && scatterKind(s, rowsOf(s)) == "linear" {
		logs = append(logs, "x")
	}
	if str(s, "yScale") == "log" {
		logs = append(logs, "y")
	}
	if len(logs) > 0 {
		list, verb := joinAnd(logs)
		t += fmt.Sprintf(" The %s axis %s logarithmic.", list, verb)
	}
	if str(s, "yLower") != "" && str(s, "yUpper") != "" {
		bars = append(bars, "vertical")
	}
	if str(s, "xLower") != "" && str(s, "xUpper") != "" {
		bars = append(bars, "horizontal")
	}
	if len(bars) > 0 {
		t += fmt.Sprintf(" Points carry %s error bars.", strings.Join(bars, " and "))
	}
	if str(s, "trend") == "loess" {
		t += " A LOESS curve shows the local trend."
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

// boxGroups are the values per group, in order of first appearance (box and violin). Mirrors groups in box.ts.
func boxGroups(s spec, rows []row) *omap[[]float64] {
	g := newOmap[[]float64]()
	for _, r := range rows {
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
	return g
}

// checkPoints are the cross-field checks shared by box and violin. Mirrors checkPoints.
func checkPoints(s spec, rows []row, issues *[]Issue) {
	if outliers, isBool := s["outliers"].(bool); has(s, "points") && isBool && !outliers && str(s, "points") != "none" {
		issue(issues, "warning", "outliers_ignored", "outliers", "`outliers: false` is ignored because `points` is set.", `Use points: "none" to hide every dot, and drop `+"`outliers`.")
	}
	if n := len(rowsOf(s)); str(s, "points") == "all" && n > 5000 {
		issue(issues, "warning", "many_marks", "points", fmt.Sprintf(`points: "all" draws %d dots.`, n), `Use points: "outliers", or sample with `+"`transform`.")
	}
	if on, _ := s["patterns"].(bool); on {
		issue(issues, "warning", "patterns_unsupported", "patterns", fmt.Sprintf("A %s chart has no series to tell apart, so patterns is ignored.", str(s, "type")))
	}
}

func describeBox(s spec) string {
	g := boxGroups(s, rowsOf(s))
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
	o := observations(rowsOf(s), str(s, "x"), has(s, "x"), columnList(s["y"]), str(s, "series"))
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

// --- maps ------------------------------------------------------------------------------------------------
// Mirrors packages/core/src/charts/maps.ts. The descriptions read the data's own spelling of a region, so they
// need no geography; only the checks do.

// blank is v === null || v === undefined || v === ”.
func blank(v any) bool {
	s, isStr := v.(string)
	return v == nil || (isStr && s == "")
}

// checkRegions warns about data values that name no region; it is an error when none match at all.
func checkRegions(s spec, rows []row, issues *[]Issue, geo *geography, fields ...string) {
	if geo == nil {
		return
	}
	names := make([]string, len(geo.regions))
	for i, r := range geo.regions {
		names[i] = r.name
	}
	for _, name := range fields {
		col := str(s, name)
		if col == "" {
			continue
		}
		seen := newOmap[string]()
		for _, r := range rows {
			v := r[col]
			if blank(v) {
				continue
			}
			if k := normalizeRegion(v); !seen.has(k) {
				seen.set(k, jsTrim(jsString(v)))
			}
		}
		var unmatched []string
		for _, k := range seen.keys {
			if _, ok := geo.lookup[k]; !ok {
				unmatched = append(unmatched, seen.m[k])
			}
		}
		if len(unmatched) == 0 {
			continue
		}
		where := "the inline geography"
		if g, ok := s["geo"].(string); ok {
			where = fmt.Sprintf("geography %q", g)
		}
		if len(unmatched) == len(seen.keys) {
			var keys []string
			for i := 0; i < len(geo.regions) && i < 8; i++ {
				keys = append(keys, geo.regions[i].key)
			}
			issue(issues, "error", "no_regions_matched", name, fmt.Sprintf("None of the %d values in %q match a region of %s.", len(seen.keys), col, where),
				"Regions are matched by key, name or alias (case ignored). Some keys: "+fmtList(keys, 8)+".")
			continue
		}
		var near, clipped []string
		for i, u := range unmatched {
			clipped = append(clipped, clip(u, 40))
			if m, ok := closest(u, names); ok && i < 5 {
				near = append(near, fmt.Sprintf("%q for %q", m, clip(u, 40)))
			}
		}
		hint := "Add aliases when registering the geography, or fix the names in the data."
		if len(near) > 0 {
			hint = "Did you mean " + strings.Join(near, ", ") + "? Or add aliases when registering the geography."
		}
		issue(issues, "warning", "unmatched_regions", name,
			fmt.Sprintf("%d of %d values in %q match no region of %s and are left out: %s.", len(unmatched), len(seen.keys), col, where, fmtList(clipped, 8)), hint)
	}
}

func checkPlaces(s spec, issues *[]Issue, lat, lng, region string) bool {
	hasLat, hasLng := str(s, lat) != "", str(s, lng) != ""
	switch {
	case hasLat && !hasLng:
		issue(issues, "error", "missing_required", lng, fmt.Sprintf("%q is set, so %q is needed too.", lat, lng))
		return false
	case hasLng && !hasLat:
		issue(issues, "error", "missing_required", lat, fmt.Sprintf("%q is set, so %q is needed too.", lng, lat))
		return false
	case hasLat && hasLng:
		return true
	}
	if region != "" && str(s, region) != "" {
		if _, ok := s["geo"]; !ok {
			issue(issues, "error", "missing_required", "geo", fmt.Sprintf("%q places rows at regions, which needs a geography.", region), "Set geo to a registered geography, or give lat and lng columns instead.")
			return false
		}
		return true
	}
	or := ""
	if region != "" {
		or = fmt.Sprintf(", or %q with a geography", region)
	}
	issue(issues, "error", "missing_required", lat, fmt.Sprintf("Give %q and %q columns%s.", lat, lng, or), "Longitude and latitude in degrees (WGS 84).")
	return false
}

// onMap reports whether a row has a usable place: valid latitude and longitude, or (without them) a region value.
func onMap(s spec, r row, lat, lng, region string) bool {
	if str(s, lat) != "" && str(s, lng) != "" {
		la, laOK := toNumber(r[str(s, lat)])
		lo, loOK := toNumber(r[str(s, lng)])
		return laOK && loOK && math.Abs(la) <= 90 && math.Abs(lo) <= 180
	}
	return str(s, region) != "" && !blank(r[str(s, region)])
}

// seriesOf is the row's group, or "" when the spec has no series column.
func seriesOf(s spec, r row) string {
	if c := str(s, "series"); c != "" {
		return orEmpty(r[c])
	}
	return ""
}

type regionValue struct {
	label string
	value float64
}

// rawValues are the region values grouped by the data's own spelling.
func rawValues(s spec, rows []row) []*regionValue {
	sums := newOmap[*regionValue]()
	for _, r := range rows {
		v, ok := toNumber(r[str(s, "value")])
		raw := r[str(s, "region")]
		if !ok || blank(raw) {
			continue
		}
		key := jsTrim(jsString(raw))
		if cur, ok := sums.get(key); ok {
			cur.value += v
		} else {
			sums.set(key, &regionValue{key, v})
		}
	}
	return sums.values()
}

func checkChoropleth(s spec, rows []row, issues *[]Issue, geo *geography) {
	checkRegions(s, rows, issues, geo, "region")
	if !anyError(*issues) && len(rawValues(s, rows)) == 0 {
		issue(issues, "error", "no_values", "value", "No row has both a region and a numeric value.")
	}
}

func describeChoropleth(s spec) string {
	vals := rawValues(s, rowsOf(s))
	f := formatter(s)
	if len(vals) == 0 {
		return lead(s, "Choropleth map") + " No values."
	}
	on := ""
	if g, ok := s["geo"].(string); ok {
		on = fmt.Sprintf(" of \"%s\"", clip(g, 64))
	}
	raised := ""
	if b, _ := s["extrude"].(bool); b {
		raised = " and raised by it"
	}
	hi := firstMax(vals, func(v *regionValue) float64 { return v.value })
	lo := firstMin(vals, func(v *regionValue) float64 { return v.value })
	return fmt.Sprintf("%s %d regions%s coloured by %s%s. Highest: %s (%s). Lowest: %s (%s).",
		lead(s, "Choropleth map"), len(vals), on, str(s, "value"), raised, clip(hi.label, 40), f(hi.value), clip(lo.label, 40), f(lo.value))
}

func placeName(s spec, r row) string {
	if c := str(s, "label"); c != "" {
		return orEmpty(r[c])
	}
	if c := str(s, "region"); c != "" {
		return jsTrim(orEmpty(r[c]))
	}
	return ""
}

type place struct {
	name    string
	size    float64
	hasSize bool
	s       string
}

// rawPlaces are the places for the description and the checks: no geography needed.
func rawPlaces(s spec, rows []row) []place {
	out := []place{}
	sizeCol := str(s, "size")
	for _, r := range rows {
		if !onMap(s, r, "lat", "lng", "region") {
			continue
		}
		p := place{name: placeName(s, r), s: seriesOf(s, r)}
		if sizeCol != "" {
			if p.size, p.hasSize = toNumber(r[sizeCol]); !p.hasSize || p.size < 0 {
				continue
			}
		}
		out = append(out, p)
	}
	return out
}

func groupsText(groups []string) string {
	if len(groups) > 1 {
		return fmt.Sprintf(", in %d groups (%s)", len(groups), fmtList(groups, 5))
	}
	return ""
}

func orDefault(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

func checkBubbleMap(s spec, rows []row, issues *[]Issue, geo *geography) {
	if !checkPlaces(s, issues, "lat", "lng", "region") {
		return
	}
	if str(s, "lat") == "" {
		checkRegions(s, rows, issues, geo, "region")
	}
	if !anyError(*issues) && len(rawPlaces(s, rows)) == 0 {
		issue(issues, "error", "no_points", "data", "No row has a usable place (and size, when set).")
	}
}

func describeBubbleMap(s spec) string {
	ps := rawPlaces(s, rowsOf(s))
	f := formatter(s)
	var groups []string
	if str(s, "series") != "" {
		names := make([]string, len(ps))
		for i, p := range ps {
			names[i] = p.s
		}
		groups = distinct(names)
	}
	sizedBy := ""
	if c := str(s, "size"); c != "" {
		sizedBy = " sized by " + c
	}
	t := fmt.Sprintf("%s %d places%s%s.", lead(s, "Bubble map"), len(ps), sizedBy, groupsText(groups))
	var sized []place
	for _, p := range ps {
		if p.hasSize {
			sized = append(sized, p)
		}
	}
	if len(sized) > 0 {
		big := firstMax(sized, func(p place) float64 { return p.size })
		t += fmt.Sprintf(" Largest: %s (%s).", clip(orDefault(big.name, "unnamed"), 40), f(big.size))
	}
	return t
}

func checkColumnMap(s spec, rows []row, issues *[]Issue, geo *geography) {
	if !checkPlaces(s, issues, "lat", "lng", "region") {
		return
	}
	if str(s, "lat") == "" {
		checkRegions(s, rows, issues, geo, "region")
	}
	neg := 0
	for _, r := range rows {
		if v, ok := toNumber(r[str(s, "value")]); ok && v < 0 {
			neg++
		}
	}
	if neg > 0 {
		issue(issues, "warning", "negative_skipped", "value", fmt.Sprintf("%d negative values are skipped: a column cannot be lower than the ground.", neg), `Use a choropleth with scale "diverging" for values above and below zero.`)
	}
}

func describeColumnMap(s spec) string {
	f := formatter(s)
	var cols []place
	var names []string
	sum := 0.0
	for _, r := range rowsOf(s) {
		v, ok := toNumber(r[str(s, "value")])
		if !ok || v < 0 || !onMap(s, r, "lat", "lng", "region") {
			continue
		}
		p := place{name: placeName(s, r), size: v, s: seriesOf(s, r)}
		cols = append(cols, p)
		names = append(names, p.s)
		sum += v
	}
	if len(cols) == 0 {
		return lead(s, "3D column map") + " No values."
	}
	top := firstMax(cols, func(p place) float64 { return p.size })
	var groups []string
	if str(s, "series") != "" {
		groups = distinct(names)
	}
	on := "globe"
	if str(s, "view") == "flat" {
		on = "tilted map"
	}
	return fmt.Sprintf("%s %d columns of %s on a %s%s, totalling %s. Tallest: %s (%s).",
		lead(s, "3D column map"), len(cols), str(s, "value"), on, groupsText(groups), f(sum), clip(orDefault(top.name, "unnamed"), 40), f(top.size))
}

var flowLL = []string{"fromLat", "fromLng", "toLat", "toLng"}

type flow struct {
	from, to string
	v        float64
	hasV     bool
}

func rawFlows(s spec, rows []row) []flow {
	out := []flow{}
	valueCol := str(s, "value")
	for _, r := range rows {
		if !onMap(s, r, "fromLat", "fromLng", "from") || !onMap(s, r, "toLat", "toLng", "to") {
			continue
		}
		var fl flow
		if valueCol != "" {
			if fl.v, fl.hasV = toNumber(r[valueCol]); !fl.hasV || fl.v < 0 {
				continue
			}
		}
		if c := str(s, "from"); c != "" {
			fl.from = jsTrim(orEmpty(r[c]))
		}
		if c := str(s, "to"); c != "" {
			fl.to = jsTrim(orEmpty(r[c]))
		}
		out = append(out, fl)
	}
	return out
}

func checkFlowMap(s spec, rows []row, issues *[]Issue, geo *geography) {
	given, missing := 0, ""
	for _, k := range flowLL {
		if str(s, k) != "" {
			given++
		} else if missing == "" {
			missing = k
		}
	}
	if given > 0 && given < 4 {
		issue(issues, "error", "missing_required", missing, "Give all four of fromLat, fromLng, toLat and toLng, or none of them.")
		return
	}
	if given == 0 {
		if str(s, "from") == "" || str(s, "to") == "" {
			path := "from"
			if str(s, "from") != "" {
				path = "to"
			}
			issue(issues, "error", "missing_required", path, "Give from and to region columns (with geo), or fromLat/fromLng/toLat/toLng columns.")
			return
		}
		if _, ok := s["geo"]; !ok {
			issue(issues, "error", "missing_required", "geo", "from and to name regions, which needs a geography.", "Set geo to a registered geography, or give fromLat/fromLng/toLat/toLng columns.")
			return
		}
		checkRegions(s, rows, issues, geo, "from", "to")
	}
	if !anyError(*issues) && len(rawFlows(s, rows)) == 0 {
		issue(issues, "error", "no_points", "data", "No row has a usable origin and destination (and value, when set).")
	}
}

func describeFlowMap(s spec) string {
	fs := rawFlows(s, rowsOf(s))
	f := formatter(s)
	weightedBy := ""
	if c := str(s, "value"); c != "" {
		weightedBy = " weighted by " + c
	}
	t := fmt.Sprintf("%s %d flows%s.", lead(s, "Flow map"), len(fs), weightedBy)
	var weighted []flow
	sum := 0.0
	for _, x := range fs {
		if x.hasV {
			weighted = append(weighted, x)
			sum += x.v
		}
	}
	if len(weighted) > 0 {
		big := firstMax(weighted, func(x flow) float64 { return x.v })
		t += fmt.Sprintf(" Total %s. Largest: %s to %s (%s).", f(sum), clip(orDefault(big.from, "origin"), 30), clip(orDefault(big.to, "destination"), 30), f(big.v))
	}
	return t
}
