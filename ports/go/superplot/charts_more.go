package superplot

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// The charts added after the first twelve: violin, calendar, sunburst, parallel, waterfall, funnel, bullet, bump,
// waffle and beeswarm. As in charts.go, every function mirrors one in packages/core/src/charts/*.ts.

// stableDesc is [...items].sort((a, b) => key(b) - key(a)): largest first, ties in their order.
func stableDesc[T any](items []T, key func(T) float64) []T {
	out := append([]T(nil), items...)
	sort.SliceStable(out, func(i, j int) bool { return key(out[i]) > key(out[j]) })
	return out
}

func clipAll(items []string, limit int) []string {
	out := make([]string, len(items))
	for i, it := range items {
		out[i] = clip(it, limit)
	}
	return out
}

// --- violin ----------------------------------------------------------------------------------------------

func checkViolin(s spec, rows []row, issues *[]Issue) {
	checkPoints(s, rows, issues)
	if bw, given := s["bandwidth"].(float64); given && bw == 0 {
		issue(issues, "error", "out_of_range", "bandwidth", "bandwidth must be above 0.", "Leave it out for Silverman's rule, or give a positive width in the units of y.")
	}
	g := boxGroups(s, rows)
	var few []string
	for _, k := range g.keys {
		if len(g.m[k]) < 5 {
			few = append(few, clip(k, 30))
		}
	}
	if len(few) > 0 {
		issue(issues, "warning", "few_values", "y", fmt.Sprintf("%d group(s) have fewer than 5 values (%s); their violin shape is mostly smoothing.", len(few), fmtList(few, 3)), `Use a box plot or points: "all" for small groups.`)
	}
}

func describeViolin(s spec) string {
	g := boxGroups(s, rowsOf(s))
	f := formatter(s)
	bw, _ := s["bandwidth"].(float64)
	groups := ""
	if str(s, "x") != "" {
		groups = fmt.Sprintf(" for %d groups (%s)", len(g.keys), fmtList(g.keys, 5))
	}
	how := " (bandwidth by Silverman's rule)"
	if bw != 0 {
		how = " with bandwidth " + f(bw)
	}
	t := fmt.Sprintf("%s Distribution of %s%s, as a Gaussian kernel density%s.", lead(s, "Violin plot"), str(s, "y"), groups, how)
	for _, k := range g.keys[:min(6, len(g.keys))] {
		st, ok := ComputeBoxStats(g.m[k])
		d, hasDensity := KDE(g.m[k], bw, 0)
		if !ok || !hasDensity {
			continue
		}
		pk := d.Peaks()
		peaks := "densest near " + f(pk[0])
		if len(pk) > 1 {
			near := make([]string, len(pk))
			for i, x := range pk {
				near[i] = f(x)
			}
			peaks = fmt.Sprintf("%d peaks, near %s", len(pk), fmtList(near, 4))
		}
		t += fmt.Sprintf(" %s: median %s, middle half %s to %s, range %s to %s, %s.", clip(k, 30), f(st.Median), f(st.Q1), f(st.Q3), f(st.Min), f(st.Max), peaks)
	}
	return t
}

// --- calendar --------------------------------------------------------------------------------------------

type dayValue struct {
	day   int64
	value float64
}

func yearOf(day int64) int64 { y, _, _ := civilFromDays(day); return y }

// calendarDays sums value per UTC calendar day (epoch day number), ascending. Mirrors calendarDays.
func calendarDays(rows []row, x, value string) []dayValue {
	sums := map[int64]float64{}
	for _, r := range rows {
		t, isTime := toTime(r[x])
		v, isNum := toNumber(r[value])
		if !isTime || !isNum {
			continue
		}
		sums[int64(math.Floor(t/dayMs))] += v
	}
	out := make([]dayValue, 0, len(sums))
	for d, v := range sums {
		out = append(out, dayValue{d, v})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].day < out[j].day })
	return out
}

// calendarYears are the years with data and the ones drawn (the last five).
func calendarYears(days []dayValue) (every, shown []int64) {
	for _, d := range days {
		if y := yearOf(d.day); len(every) == 0 || every[len(every)-1] != y {
			every = append(every, y)
		}
	}
	return every, every[max(0, len(every)-maxCalendarYears):]
}

func checkCalendar(s spec, rows []row, issues *[]Issue) {
	x := str(s, "x")
	seen, bad := 0, 0
	for _, r := range rows {
		v := r[x]
		if blank(v) {
			continue
		}
		seen++
		if _, ok := toTime(v); !ok {
			bad++
		}
	}
	if seen > 0 && bad == seen {
		issue(issues, "error", "not_time", "x", fmt.Sprintf("Column %q has no dates.", x), `Use ISO dates such as "2026-03-14" or epoch milliseconds.`)
	} else if bad > 0 {
		issue(issues, "warning", "some_not_time", "x", fmt.Sprintf("%d of %d values in %q are not dates and will be skipped.", bad, seen, x))
	}
	days := calendarDays(rows, x, str(s, "value"))
	if seen > 0 && bad < seen && len(days) == 0 {
		issue(issues, "error", "no_values", "value", "No row has both a date and a numeric value.")
	}
	if every, shown := calendarYears(days); len(every) > maxCalendarYears {
		issue(issues, "warning", "too_many_years", "x", fmt.Sprintf("The data spans %d years; only the last %d (%d to %d) are drawn.", len(every), maxCalendarYears, shown[0], shown[len(shown)-1]), "Filter with `transform`, or aggregate to weeks or months and use a line or bar chart.")
	}
	if on, _ := s["patterns"].(bool); on {
		issue(issues, "warning", "patterns_unsupported", "patterns", "A calendar has one colour scale and no series, so patterns is ignored.")
	}
}

func describeCalendar(s spec) string {
	f := formatter(s)
	days := calendarDays(rowsOf(s), str(s, "x"), str(s, "value"))
	every, shown := calendarYears(days)
	var kept []dayValue
	for _, d := range days {
		if len(shown) > 0 && yearOf(d.day) >= shown[0] {
			kept = append(kept, d)
		}
	}
	if len(kept) == 0 {
		return lead(s, "Calendar heatmap") + " No days with data."
	}
	date := func(d int64) string { return formatDate(float64(d) * dayMs) }
	first, last := kept[0].day, kept[len(kept)-1].day
	span := int(last - first + 1)
	hi := firstMax(kept, func(d dayValue) float64 { return d.value })
	lo := firstMin(kept, func(d dayValue) float64 { return d.value })
	vals := make([]float64, len(kept))
	for i, d := range kept {
		vals[i] = d.value
	}
	t := fmt.Sprintf("%s %d days with data from %s to %s, coloured by %s, totalling %s.", lead(s, "Calendar heatmap"), len(kept), date(first), date(last), str(s, "value"), f(total(vals)))
	if span > len(kept) {
		t += fmt.Sprintf(" %d days in that span have no data.", span-len(kept))
	}
	t += fmt.Sprintf(" Highest: %s (%s). Lowest: %s (%s).", date(hi.day), f(hi.value), date(lo.day), f(lo.value))
	var sums [7]float64
	var counts [7]int
	for _, d := range kept {
		w := ((d.day+4)%7 + 7) % 7 // 1970-01-01 was a Thursday
		sums[w] += d.value
		counts[w]++
	}
	type avg struct {
		mean float64
		day  int
	}
	var means []avg
	for i := 0; i < 7; i++ {
		if counts[i] > 0 {
			means = append(means, avg{sums[i] / float64(counts[i]), i})
		}
	}
	if ranked := stableDesc(means, func(a avg) float64 { return a.mean }); len(ranked) > 1 {
		top, bottom := ranked[0], ranked[len(ranked)-1]
		t += fmt.Sprintf(" On average %s is highest (%s) and %s lowest (%s).", weekdays[top.day], f(top.mean), weekdays[bottom.day], f(bottom.mean))
	}
	if len(every) > len(shown) {
		t += fmt.Sprintf(" Only the last %d of %d years are drawn.", len(shown), len(every))
	}
	return t
}

// --- sunburst --------------------------------------------------------------------------------------------

type hnode struct {
	name     string
	path     []string
	value    float64
	children []*hnode
	index    map[string]*hnode
}

// hierarchy sums value over a hierarchy given by levels (outermost first). Mirrors hierarchy in sunburst.ts: a row
// stops at its first empty level; children are ordered largest first, the smallest past 30 merged into "Other".
func hierarchy(rows []row, levels []string, value string) *hnode {
	root := &hnode{index: map[string]*hnode{}}
	for _, r := range rows {
		v, ok := toNumber(r[value])
		if !ok || v <= 0 {
			continue
		}
		root.value += v
		node := root
		for _, col := range levels {
			raw := r[col]
			if blank(raw) {
				break
			}
			name := jsString(raw)
			child := node.index[name]
			if child == nil {
				child = &hnode{name: name, path: append(append([]string(nil), node.path...), name), index: map[string]*hnode{}}
				node.index[name] = child
				node.children = append(node.children, child)
			}
			child.value += v
			node = child
		}
	}
	var tidy func(n *hnode)
	tidy = func(n *hnode) {
		n.children = stableDesc(n.children, func(c *hnode) float64 { return c.value })
		if len(n.children) > maxChildren {
			rest := n.children[maxChildren-1:]
			vals := make([]float64, len(rest))
			for i, c := range rest {
				vals[i] = c.value
			}
			other := &hnode{name: "Other", path: append(append([]string(nil), n.path...), "Other"), value: total(vals)}
			n.children = append(append([]*hnode(nil), n.children[:maxChildren-1]...), other)
		}
		for _, c := range n.children {
			tidy(c)
		}
	}
	tidy(root)
	return root
}

func duplicateColumns(cols []string, field, what, hint string, issues *[]Issue) {
	seen := map[string]bool{}
	for i, c := range cols {
		if seen[c] {
			issue(issues, "error", "duplicate_column", fmt.Sprintf("%s[%d]", field, i), fmt.Sprintf("%q appears twice in %s.", c, what), hint)
		}
		seen[c] = true
	}
}

func checkSunburst(s spec, rows []row, issues *[]Issue) {
	levels := columnList(s["path"])
	duplicateColumns(levels, "path", "path", "Each level of the hierarchy needs its own column.", issues)
	value := str(s, "value")
	if contains(levels, value) {
		issue(issues, "warning", "value_in_path", "value", fmt.Sprintf("%q is both a level and the value.", value))
	}
	neg := 0
	for _, r := range rows {
		if v, ok := toNumber(r[value]); ok && v <= 0 {
			neg++
		}
	}
	if neg > 0 {
		issue(issues, "warning", "negative_slices", "value", fmt.Sprintf("%d zero or negative value(s) will be skipped; a share cannot be negative.", neg))
	}
}

func describeSunburst(s spec) string {
	levels := columnList(s["path"])
	root := hierarchy(rowsOf(s), levels, str(s, "value"))
	f := formatter(s)
	pct := func(v float64) string {
		if root.value == 0 {
			return FormatPercent(0, 1)
		}
		return FormatPercent(v/root.value, 1)
	}
	if len(root.children) == 0 {
		return lead(s, "Sunburst") + " No positive values."
	}
	leaves := 0
	var biggest *hnode
	var walk func(n *hnode)
	walk = func(n *hnode) {
		if len(n.children) == 0 {
			leaves++
			if biggest == nil || n.value > biggest.value {
				biggest = n
			}
		}
		for _, c := range n.children {
			walk(c)
		}
	}
	for _, c := range root.children {
		walk(c)
	}
	var top []string
	for _, n := range root.children[:min(3, len(root.children))] {
		top = append(top, fmt.Sprintf("%s (%s)", clip(n.name, 30), pct(n.value)))
	}
	t := fmt.Sprintf("%s %d level%s (%s), %d leaves totalling %s. First level: %d groups, largest %s.", lead(s, "Sunburst"), len(levels), plural(len(levels), "", "s"), strings.Join(levels, " > "), leaves, f(root.value), len(root.children), fmtList(top, 3))
	if biggest != nil && len(biggest.path) > 1 {
		t += fmt.Sprintf(" Largest leaf: %s (%s, %s).", clip(strings.Join(biggest.path, " > "), 80), f(biggest.value), pct(biggest.value))
	}
	return t
}

// --- parallel --------------------------------------------------------------------------------------------

type completeRow struct {
	r      row
	values []float64
}

// complete are the rows with a number in every dimension, each with its values in dimension order.
func complete(rows []row, dims []string) []completeRow {
	var out []completeRow
	for _, r := range rows {
		values := make([]float64, 0, len(dims))
		for _, d := range dims {
			v, ok := toNumber(r[d])
			if !ok {
				break
			}
			values = append(values, v)
		}
		if len(values) == len(dims) {
			out = append(out, completeRow{r, values})
		}
	}
	return out
}

// sampleLines is (lines drawn, step): every row up to maxLines, else every k-th. Mirrors sampleRows.
func sampleLines(n int) (int, int) {
	if n <= maxLines {
		return n, 1
	}
	step := (n + maxLines - 1) / maxLines
	return (n + step - 1) / step, step
}

func checkParallel(s spec, rows []row, issues *[]Issue) {
	dims := columnList(s["dimensions"])
	duplicateColumns(dims, "dimensions", "dimensions", "Each axis needs its own column.", issues)
	every := complete(rows, dims)
	if skipped := len(rows) - len(every); len(every) == 0 {
		issue(issues, "error", "no_values", "dimensions", "No row has a number in every dimension.", "Fill or filter out rows with missing values.")
	} else if skipped > 0 {
		issue(issues, "warning", "incomplete_rows", "dimensions", fmt.Sprintf("%d row(s) lack a number in some dimension and are not drawn.", skipped))
	}
	if drawn, step := sampleLines(len(every)); step > 1 {
		issue(issues, "warning", "lines_sampled", "data", fmt.Sprintf("One row in every %d is drawn (%d lines). The axes still span every row.", step, drawn), "Filter or aggregate with `transform`.")
	}
	if on, _ := s["patterns"].(bool); on {
		issue(issues, "warning", "patterns_unsupported", "patterns", "Parallel coordinates draw lines, which have no fill to texture; patterns is ignored.")
	}
}

func describeParallel(s spec) string {
	dims := columnList(s["dimensions"])
	every := complete(rowsOf(s), dims)
	f := formatter(s)
	if len(every) == 0 {
		return lead(s, "Parallel coordinates") + " No complete rows."
	}
	column := func(i int) []float64 {
		out := make([]float64, len(every))
		for j, e := range every {
			out[j] = e.values[i]
		}
		return out
	}
	by, grouped := s["series"].(string)
	groups := ""
	if grouped {
		names := make([]string, len(every))
		for i, e := range every {
			names[i] = keyString(e.r[by])
		}
		if g := distinct(names); len(g) > 0 {
			groups = fmt.Sprintf(", in %d groups by %s (%s)", len(g), by, fmtList(g, 5))
		}
	}
	t := fmt.Sprintf("%s %d rows across %d measures (%s)%s.", lead(s, "Parallel coordinates"), len(every), len(dims), fmtList(dims, 6), groups)
	var ranges []string
	for i, d := range dims[:min(6, len(dims))] {
		lo, hi, _ := extent(column(i))
		ranges = append(ranges, fmt.Sprintf("%s %s to %s", clip(d, 30), f(lo), f(hi)))
	}
	t += fmt.Sprintf(" Ranges: %s.", strings.Join(ranges, "; "))
	bestAt, bestR := -1, 0.0
	for i := 0; i < len(dims)-1; i++ {
		if r, ok := correlation(column(i), column(i+1)); ok && (bestAt < 0 || math.Abs(r) > math.Abs(bestR)) {
			bestAt, bestR = i, r
		}
	}
	if bestAt >= 0 {
		t += fmt.Sprintf(" Strongest link between neighbouring axes: %s and %s (r = %s).", clip(dims[bestAt], 30), clip(dims[bestAt+1], 30), toFixed(bestR, 2))
	}
	if drawn, step := sampleLines(len(every)); step > 1 {
		t += fmt.Sprintf(" One row in every %d is drawn (%d lines).", step, drawn)
	}
	return t
}

// --- waterfall -------------------------------------------------------------------------------------------

// isYes reads a yes/no cell of a flag column: true, 1, or "true", "yes", "1", "total", "subtotal" (any case, trimmed).
func isYes(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case float64:
		return x == 1
	case string:
		switch strings.ToLower(jsTrim(x)) {
		case "true", "yes", "1", "total", "subtotal":
			return true
		}
	}
	return false
}

// flagged: is this row marked by a flag field? A column name reads the row's yes/no cell; a list matches the row's
// value in keyColumn (as a string). Mirrors flagged in schema.ts.
func flagged(flag any, r row, keyColumn string, hasKey bool) bool {
	switch x := flag.(type) {
	case string:
		return isYes(r[x])
	case []any:
		v := r[keyColumn]
		if !hasKey || v == nil {
			return false
		}
		text := jsString(v)
		for _, e := range x {
			if e == text {
				return true
			}
		}
	}
	return false
}

type waterfallStep struct {
	key, kind       string
	change, running float64
}

type waterfall struct {
	steps      []waterfallStep
	start, end float64
	mismatches []string
	duplicates int
}

// waterfallModel are the steps in data order (duplicate labels summed). Mirrors waterfallModel.
func waterfallModel(s spec, rows []row) waterfall {
	type sum struct {
		v   float64
		has bool
	}
	sums := newOmap[sum]()
	isTotal := map[string]bool{}
	m := waterfall{}
	x, y := str(s, "x"), str(s, "y")
	for _, r := range rows {
		k := keyString(r[x])
		v, ok := toNumber(r[y])
		if prev, seen := sums.get(k); !seen {
			sums.set(k, sum{v, ok})
		} else {
			m.duplicates++
			if ok {
				sums.set(k, sum{prev.v + v, true})
			}
		}
		if flagged(s["total"], r, x, true) {
			isTotal[k] = true
		}
	}
	m.start, _ = s["start"].(float64)
	running := m.start
	for i, key := range sums.keys {
		v := sums.m[key]
		if isTotal[key] {
			value := running
			if v.has {
				value = v.v
			}
			if checked := i > 0 || has(s, "start"); v.has && checked && math.Abs(v.v-running) > float64(1e-9*math.Max(1, math.Abs(running))) {
				m.mismatches = append(m.mismatches, key)
			}
			m.steps = append(m.steps, waterfallStep{key: key, kind: "total", running: value})
			running = value
			continue
		}
		if !v.has {
			continue
		}
		kind := "decrease"
		if v.v >= 0 {
			kind = "increase"
		}
		m.steps = append(m.steps, waterfallStep{key, kind, v.v, running + v.v})
		running += v.v
	}
	m.end = running
	return m
}

func checkWaterfall(s spec, rows []row, issues *[]Issue) {
	names := make([]string, len(rows))
	for i, r := range rows {
		names[i] = keyString(r[str(s, "x")])
	}
	keys := distinct(names)
	switch tot := s["total"].(type) {
	case []any:
		for i, e := range tot {
			t, _ := e.(string)
			if contains(keys, t) {
				continue
			}
			var hint []string
			if near, found := closest(t, keys); found {
				hint = []string{fmt.Sprintf("Did you mean %q?", near)}
			}
			issue(issues, "warning", "no_such_step", fmt.Sprintf("total[%d]", i), fmt.Sprintf("No step is labelled %q; it was ignored.", clip(t, 60)), hint...)
		}
	case string:
		any := false
		for _, r := range rows {
			any = any || flagged(tot, r, "", false)
		}
		if !any {
			issue(issues, "warning", "no_totals", "total", fmt.Sprintf("No row of %q says yes, so no step is drawn as a total.", tot), `Use true, 1, "yes" or "total" for the total rows.`)
		}
	}
	m := waterfallModel(s, rows)
	if m.duplicates > 0 {
		issue(issues, "warning", "duplicate_steps", "x", fmt.Sprintf("%d row(s) repeat a step label; their changes were summed into one bar.", m.duplicates))
	}
	if len(m.mismatches) > 0 {
		issue(issues, "warning", "total_mismatch", "total", "The value given for a total differs from the sum of the steps before it; the given value is drawn.", "Leave y empty on a total row to draw the computed running total.")
	}
	if len(m.steps) == 0 {
		issue(issues, "error", "empty_data", "y", "No step has a numeric change and no row is a total.", "Give each step a signed number in y.")
	}
}

func describeWaterfall(s spec) string {
	m := waterfallModel(s, rowsOf(s))
	f := formatter(s)
	sg := func(v float64) string {
		if v > 0 {
			return "+" + f(v)
		}
		return f(v)
	}
	var changes, totals, ups, downs []waterfallStep
	for _, st := range m.steps {
		switch {
		case st.kind == "total":
			totals = append(totals, st)
			continue
		case st.change > 0:
			ups = append(ups, st)
		case st.change < 0:
			downs = append(downs, st)
		}
		changes = append(changes, st)
	}
	opening := m.start
	if len(m.steps) > 0 && m.steps[0].kind == "total" {
		opening = m.steps[0].running
	}
	and := ""
	if len(totals) > 0 {
		and = fmt.Sprintf(" and %d %s", len(totals), plural(len(totals), "total", "totals"))
	}
	t := fmt.Sprintf("%s %d %s%s, from %s to %s (net %s).", lead(s, "Waterfall chart"), len(changes), plural(len(changes), "change", "changes"), and, f(opening), f(m.end), sg(m.end-opening))
	if len(ups) > 0 {
		u := firstMax(ups, func(st waterfallStep) float64 { return st.change })
		t += fmt.Sprintf(" Largest increase: %s (%s).", clip(u.key, 40), sg(u.change))
	}
	if len(downs) > 0 {
		d := firstMin(downs, func(st waterfallStep) float64 { return st.change })
		t += fmt.Sprintf(" Largest decrease: %s (%s).", clip(d.key, 40), sg(d.change))
	}
	if len(totals) > 0 {
		var listed []string
		for _, st := range totals[:min(5, len(totals))] {
			listed = append(listed, clip(st.key, 30)+" "+f(st.running))
		}
		more := ""
		if len(totals) > 5 {
			more = fmt.Sprintf(" and %d more", len(totals)-5)
		}
		t += fmt.Sprintf(" Totals: %s%s.", strings.Join(listed, ", "), more)
	}
	return t
}

// --- funnel ----------------------------------------------------------------------------------------------

type funnelStage struct {
	key                   string
	value                 float64
	ofFirst, ofPrevious   float64
	hasFirst, hasPrevious bool
}

// funnelStages are the stages in data order, duplicates summed; rows without a number and negative values are left out.
func funnelStages(s spec, rows []row) (stages []funnelStage, negative, duplicates int) {
	sums := newOmap[float64]()
	for _, r := range rows {
		v, ok := toNumber(r[str(s, "value")])
		if !ok {
			continue
		}
		if v < 0 {
			negative++
			continue
		}
		k := keyString(r[str(s, "stage")])
		cur, seen := sums.get(k)
		if seen {
			duplicates++
		}
		sums.set(k, cur+v)
	}
	for i, key := range sums.keys {
		st := funnelStage{key: key, value: sums.m[key]}
		if first := sums.m[sums.keys[0]]; first > 0 {
			st.ofFirst, st.hasFirst = st.value/first, true
		}
		if i > 0 {
			if prev := sums.m[sums.keys[i-1]]; prev > 0 {
				st.ofPrevious, st.hasPrevious = st.value/prev, true
			}
		}
		stages = append(stages, st)
	}
	return stages, negative, duplicates
}

func funnelRises(stages []funnelStage) bool {
	for i := 1; i < len(stages); i++ {
		if stages[i].value > stages[i-1].value {
			return true
		}
	}
	return false
}

func checkFunnel(s spec, rows []row, issues *[]Issue) {
	stages, negative, duplicates := funnelStages(s, rows)
	if len(stages) > maxStages {
		issue(issues, "error", "too_many_stages", "stage", fmt.Sprintf("%d stages; a funnel takes at most %d.", len(stages), maxStages), "Group stages, or use a bar chart.")
	}
	if len(stages) == 0 {
		issue(issues, "error", "empty_data", "value", "No stage has a value of 0 or more.")
	}
	if negative > 0 {
		issue(issues, "warning", "negative_values", "value", fmt.Sprintf("%d negative value(s) were skipped; a funnel cannot show them.", negative))
	}
	if duplicates > 0 {
		issue(issues, "warning", "duplicate_stages", "stage", fmt.Sprintf("%d row(s) repeat a stage name; their values were summed.", duplicates))
	}
	if funnelRises(stages) {
		issue(issues, "warning", "funnel_increases", "value", "A stage is larger than the one before it; a funnel reads as narrowing, so it misleads here. Drawn anyway.", "Check the stage order, or use a bar chart for stages that are not subsets of each other.")
	}
}

func describeFunnel(s spec) string {
	stages, _, _ := funnelStages(s, rowsOf(s))
	f := formatter(s)
	if len(stages) == 0 {
		return lead(s, "Funnel chart") + " No stages."
	}
	first, last := stages[0], stages[len(stages)-1]
	if len(stages) == 1 {
		return fmt.Sprintf("%s 1 stage: %s, %s.", lead(s, "Funnel chart"), clip(first.key, 40), f(first.value))
	}
	names := make([]string, len(stages))
	for i, st := range stages {
		names[i] = clip(st.key, 30)
	}
	t := fmt.Sprintf("%s %d stages (%s), from %s at %s to %s at %s", lead(s, "Funnel chart"), len(stages), fmtList(names, 5), f(first.value), clip(first.key, 40), f(last.value), clip(last.key, 40))
	if !last.hasFirst {
		t += "; the first stage is 0, so there are no shares of it."
	} else {
		t += fmt.Sprintf(": %s of the first stage reach the last.", FormatPercent(last.ofFirst, 1))
	}
	worst := -1
	for i, st := range stages {
		if i > 0 && st.hasPrevious && (worst < 0 || st.ofPrevious < stages[worst].ofPrevious) {
			worst = i
		}
	}
	if worst > 0 && stages[worst].ofPrevious < 1 {
		t += fmt.Sprintf(" Largest drop: %s to %s, %s continue.", clip(stages[worst-1].key, 40), clip(stages[worst].key, 40), FormatPercent(stages[worst].ofPrevious, 1))
	}
	if funnelRises(stages) {
		t += " The value rises between some stages."
	}
	return t
}

// --- bullet ----------------------------------------------------------------------------------------------

type bulletRange struct {
	name  string
	limit float64
}

type bulletRow struct {
	key                 string
	value, target       float64
	hasValue, hasTarget bool
	ranges              []bulletRange
}

// bulletRows is one row per measure (the first row of a repeated name wins). Mirrors bulletRows.
func bulletRows(s spec, rows []row) (out []bulletRow, duplicates int, unordered []string) {
	seen := map[string]bool{}
	names := columnList(s["ranges"])
	for _, r := range rows {
		key := keyString(r[str(s, "x")])
		if seen[key] {
			duplicates++
			continue
		}
		seen[key] = true
		b := bulletRow{key: key}
		rising := true
		for _, n := range names {
			if v, ok := toNumber(r[n]); ok {
				if k := len(b.ranges); k > 0 && v < b.ranges[k-1].limit {
					rising = false
				}
				b.ranges = append(b.ranges, bulletRange{n, v})
			}
		}
		if !rising {
			unordered = append(unordered, key)
		}
		sort.SliceStable(b.ranges, func(i, j int) bool { return b.ranges[i].limit < b.ranges[j].limit })
		b.value, b.hasValue = toNumber(r[str(s, "value")])
		if t := str(s, "target"); t != "" {
			b.target, b.hasTarget = toNumber(r[t])
		}
		out = append(out, b)
	}
	return out, duplicates, unordered
}

func checkBullet(s spec, rows []row, issues *[]Issue) {
	if str(s, "target") == "" && len(columnList(s["ranges"])) == 0 {
		issue(issues, "warning", "prefer_bar", "type", "Without a target or ranges a bullet chart is a bar chart.", "Add `target` and `ranges`, or use `type: \"bar\"`.")
	}
	_, duplicates, unordered := bulletRows(s, rows)
	if duplicates > 0 {
		issue(issues, "warning", "duplicate_measures", "x", fmt.Sprintf("%d row(s) repeat a measure name; only the first row of each is drawn.", duplicates))
	}
	if len(unordered) > 0 {
		issue(issues, "warning", "ranges_not_increasing", "ranges", "Some thresholds do not increase in column order; they were sorted.", "List range columns worst first, each threshold higher than the one before.")
	}
}

func describeBullet(s spec) string {
	rows, _, _ := bulletRows(s, rowsOf(s))
	f := formatter(s)
	names := columnList(s["ranges"])
	keys := make([]string, len(rows))
	for i, r := range rows {
		keys[i] = clip(r.key, 30)
	}
	t := fmt.Sprintf("%s %d %s (%s)", lead(s, "Bullet chart"), len(rows), plural(len(rows), "measure", "measures"), fmtList(keys, 5))
	if str(s, "target") != "" {
		t += " against targets"
	}
	if len(names) > 0 {
		t += ", with ranges " + fmtList(names, 5)
	}
	if str(s, "scale") == "each" {
		t += ", each on its own scale"
	}
	t += "."
	for _, r := range rows[:min(6, len(rows))] {
		if !r.hasValue {
			t += fmt.Sprintf(" %s: no value.", clip(r.key, 30))
			continue
		}
		t += fmt.Sprintf(" %s: %s", clip(r.key, 30), f(r.value))
		if r.hasTarget {
			t += " against " + f(r.target)
			if r.target != 0 {
				t += fmt.Sprintf(" (%s of target)", FormatPercent(r.value/r.target, 1))
			}
		}
		if len(r.ranges) > 0 {
			in := ""
			for _, g := range r.ranges {
				if r.value <= g.limit {
					in = g.name
					break
				}
			}
			if in != "" {
				t += ", in " + in
			} else {
				t += ", above every range"
			}
		}
		t += "."
	}
	if len(rows) > 6 {
		t += fmt.Sprintf(" And %d more.", len(rows)-6)
	}
	return t
}

// --- bump ------------------------------------------------------------------------------------------------

type bump struct {
	xs, all, keys        []string
	ranks                map[string]*omap[float64]
	duplicates, badRanks int
}

// bumpModel are the ranks per x, from a rank column or by ranking y among the series present at that x.
// Mirrors bumpModel.
func bumpModel(s spec, rows []row) bump {
	x, rank, series := str(s, "x"), str(s, "rank"), str(s, "series")
	kind := detectXKind("auto", values(rows, x))
	var names []string
	for _, r := range rows {
		if v := r[x]; !blank(v) {
			names = append(names, keyString(v))
		}
	}
	m := bump{xs: distinct(names), ranks: map[string]*omap[float64]{}}
	if kind != "category" {
		num := func(k string) float64 {
			var n float64
			if kind == "time" {
				n, _ = toTime(k)
			} else {
				n, _ = toNumber(k)
			}
			return n
		}
		sort.SliceStable(m.xs, func(i, j int) bool { return num(m.xs[i]) < num(m.xs[j]) })
	}
	ranksOf := func(k string) *omap[float64] {
		if m.ranks[k] == nil {
			m.ranks[k] = newOmap[float64]()
		}
		return m.ranks[k]
	}
	var every []string
	if rank != "" {
		for _, r := range rows {
			every = append(every, keyString(r[series]))
		}
		every = distinct(every)
		for _, r := range rows {
			xv := r[x]
			if blank(xv) {
				continue
			}
			v, ok := toNumber(r[rank])
			if !ok {
				continue
			}
			if v < 1 {
				m.badRanks++
				continue
			}
			if of := ranksOf(keyString(r[series])); of.has(keyString(xv)) {
				m.duplicates++
			} else {
				of.set(keyString(xv), v)
			}
		}
	} else {
		o := observations(rows, x, true, columnList(s["y"]), series)
		vals := map[string]map[string]float64{}
		for _, ob := range o {
			every = append(every, ob.s)
			if !ob.hasY || blank(ob.x) {
				continue
			}
			if vals[ob.s] == nil {
				vals[ob.s] = map[string]float64{}
			}
			k := keyString(ob.x)
			if _, seen := vals[ob.s][k]; seen {
				m.duplicates++
			}
			vals[ob.s][k] += ob.y
		}
		every = distinct(every)
		desc := str(s, "rankBy") != "asc"
		for _, xk := range m.xs {
			var present []string
			for _, k := range every {
				if _, ok := vals[k][xk]; ok {
					present = append(present, k)
				}
			}
			sort.SliceStable(present, func(i, j int) bool {
				a, b := vals[present[i]][xk], vals[present[j]][xk]
				if desc {
					return a > b
				}
				return a < b
			})
			for i, k := range present {
				ranksOf(k).set(xk, float64(i+1))
			}
		}
	}
	for _, k := range every {
		if of := m.ranks[k]; of != nil && len(of.keys) > 0 {
			m.all = append(m.all, k)
		}
	}
	m.keys = m.all
	if limit := data.Limits["maxSeries"]; len(m.all) > limit {
		meanRank := func(k string) float64 { of := m.ranks[k]; return total(of.values()) / float64(len(of.keys)) }
		byRank := append([]string(nil), m.all...)
		sort.SliceStable(byRank, func(i, j int) bool { return meanRank(byRank[i]) < meanRank(byRank[j]) })
		m.keys = nil
		for _, k := range m.all {
			if contains(byRank[:limit], k) {
				m.keys = append(m.keys, k)
			}
		}
	}
	return m
}

func checkBump(s spec, rows []row, issues *[]Issue) {
	rank, series := str(s, "rank"), str(s, "series")
	ys := columnList(s["y"])
	_, yList := s["y"].([]any)
	hasY := len(ys) > 0 && (yList || ys[0] != "")
	if rank == "" && !hasY {
		issue(issues, "error", "missing_required", "y", "A bump chart needs `rank` (a column of ranks) or `y` (values to rank per x).", `E.g. "y": "points", "series": "team".`)
		return
	}
	if rank != "" && series == "" {
		issue(issues, "error", "missing_required", "series", "`rank` needs `series`: the column naming whose rank each row is.")
		return
	}
	if rank != "" && hasY {
		issue(issues, "warning", "y_ignored", "y", "`y` is ignored when `rank` is given.")
	}
	if rank == "" && yList && len(ys) > 1 && series != "" {
		issue(issues, "warning", "series_ignored", "series", "`series` is ignored when `y` lists several columns.")
	}
	if has(s, "rankBy") && str(s, "rankBy") != "desc" && rank != "" {
		issue(issues, "warning", "rank_by_ignored", "rankBy", "`rankBy` only applies when ranks come from `y`.")
	}
	if on, _ := s["patterns"].(bool); on {
		issue(issues, "warning", "patterns_unsupported", "patterns", "A bump chart has lines and dots, no filled areas, so patterns do not apply.")
	}
	m := bumpModel(s, rows)
	limit := data.Limits["maxSeries"]
	if m.badRanks > 0 {
		issue(issues, "warning", "bad_rank", "rank", fmt.Sprintf("%d rank(s) below 1 were skipped; rank 1 is the best.", m.badRanks))
	}
	if m.duplicates > 0 {
		path := "y"
		if rank != "" {
			path = "rank"
		}
		issue(issues, "warning", "duplicate_points", path, fmt.Sprintf("%d row(s) repeat a series at the same x.", m.duplicates))
	}
	if len(m.all) > limit {
		issue(issues, "warning", "too_many_series", "series", fmt.Sprintf("%d series; only the %d with the best average rank are drawn.", len(m.all), limit), "Filter first, e.g. a `top` step in `transform`.")
	} else if len(m.all) == 1 {
		issue(issues, "warning", "single_series", "series", "A bump chart compares ranks; with one series it is always first.", "Add `series`, or use a line chart.")
	}
	if len(m.xs) < 2 {
		issue(issues, "warning", "single_step", "x", "Only one x value: there is no change of rank to show.")
	}
}

func describeBump(s spec) string {
	m := bumpModel(s, rowsOf(s))
	first, last := "", ""
	if len(m.xs) > 0 {
		first, last = m.xs[0], m.xs[len(m.xs)-1]
	}
	n := func(v float64) string { return numberString(r2(v)) }
	t := fmt.Sprintf("%s Ranks of %d series (%s) over %d steps from %s to %s", lead(s, "Bump chart"), len(m.keys), fmtList(clipAll(m.keys, 30), 5), len(m.xs), clip(first, 30), clip(last, 30))
	if str(s, "rank") != "" {
		t += "."
	} else {
		by := "value"
		if y, one := s["y"].(string); one {
			by = clip(y, 40)
		}
		order := "highest"
		if str(s, "rankBy") == "asc" {
			order = "lowest"
		}
		t += fmt.Sprintf(", ranked by %s, %s first.", by, order)
	}
	var end []string
	if len(m.xs) > 0 {
		for _, k := range m.keys {
			if m.ranks[k].has(last) {
				end = append(end, k)
			}
		}
		sort.SliceStable(end, func(i, j int) bool { return m.ranks[end[i]].m[last] < m.ranks[end[j]].m[last] })
	}
	if len(end) > 0 {
		var listed []string
		for _, k := range end[:min(5, len(end))] {
			listed = append(listed, fmt.Sprintf("%s. %s", n(m.ranks[k].m[last]), clip(k, 30)))
		}
		t += fmt.Sprintf(" At %s: %s.", clip(last, 30), strings.Join(listed, ", "))
	}
	type move struct {
		k        string
		from, to float64
	}
	var up, down *move
	for _, k := range m.keys {
		rk := m.ranks[k]
		var seen []string
		for _, x := range m.xs {
			if rk.has(x) {
				seen = append(seen, x)
			}
		}
		if len(seen) < 2 {
			continue
		}
		a, b := rk.m[seen[0]], rk.m[seen[len(seen)-1]]
		if b < a && (up == nil || a-b > up.from-up.to) {
			up = &move{k, a, b}
		}
		if b > a && (down == nil || b-a > down.to-down.from) {
			down = &move{k, a, b}
		}
	}
	if up != nil {
		t += fmt.Sprintf(" Biggest climb: %s, from %s to %s.", clip(up.k, 30), n(up.from), n(up.to))
	}
	if down != nil {
		t += fmt.Sprintf(" Biggest fall: %s, from %s to %s.", clip(down.k, 30), n(down.from), n(down.to))
	}
	return t
}

// --- waffle ----------------------------------------------------------------------------------------------

// waffleParts are the categories with their summed value; past eight the smallest merge into "Other". Mirrors parts.
func waffleParts(s spec, rows []row) []slice {
	sums := map[string]float64{}
	counted := map[string]bool{}
	labels := make([]string, len(rows))
	for i, r := range rows {
		k := orEmpty(r[str(s, "label")])
		labels[i] = k
		if n, ok := toNumber(r[str(s, "value")]); ok && n >= 0 {
			sums[k] += n
			counted[k] = true
		}
	}
	var parts []slice
	for _, k := range distinct(labels) {
		if counted[k] {
			parts = append(parts, slice{k, sums[k]})
		}
	}
	if so := str(s, "sort"); so != "" && so != "none" {
		sort.SliceStable(parts, func(i, j int) bool {
			if so == "asc" {
				return parts[i].value < parts[j].value
			}
			return parts[i].value > parts[j].value
		})
	}
	if limit := data.Limits["maxSeries"]; len(parts) > limit {
		keep := map[string]bool{}
		for _, p := range stableDesc(parts, func(p slice) float64 { return p.value })[:limit-1] {
			keep[p.key] = true
		}
		var kept []slice
		var rest []float64
		for _, p := range parts {
			if keep[p.key] {
				kept = append(kept, p)
			} else {
				rest = append(rest, p.value)
			}
		}
		parts = append(kept, slice{"Other", total(rest)})
	}
	return parts
}

func checkWaffle(s spec, rows []row, issues *[]Issue) {
	if cells, given := s["cells"].(float64); given && math.Mod(cells, 10) != 0 {
		issue(issues, "error", "bad_value", "cells", fmt.Sprintf("cells must be a multiple of 10 so the grid is a full rectangle; got %s.", numberString(cells)))
	}
	positive := false
	for _, p := range waffleParts(s, rows) {
		positive = positive || p.value > 0
	}
	if !positive {
		issue(issues, "error", "no_positive_values", "value", "No category has a positive value; a waffle needs a whole to share out.", "Check the value column, or the transform that produced it.")
	}
}

func describeWaffle(s spec) string {
	parts := waffleParts(s, rowsOf(s))
	cells := 100.0
	if c, given := s["cells"].(float64); given {
		cells = c
	}
	vals := make([]float64, len(parts))
	for i, p := range parts {
		vals[i] = p.value
	}
	tot := total(vals)
	f := formatter(s)
	cols, rows := waffleGrid(cells)
	n := numberString
	t := fmt.Sprintf("%s %d %s totalling %s, as %s cells (%s by %s; one cell is %s).", lead(s, "Waffle chart"), len(parts), plural(len(parts), "category", "categories"), f(tot), n(cells), n(cols), n(rows), FormatPercent(1/cells, 2))
	if tot > 0 {
		counts := WaffleCells(vals, int(cells))
		order := make([]int, len(parts))
		for i := range order {
			order[i] = i
		}
		ranked := stableDesc(order, func(i int) float64 { return parts[i].value })
		var listed []string
		for _, i := range ranked[:min(5, len(ranked))] {
			listed = append(listed, fmt.Sprintf("%s %s (%d %s)", clip(parts[i].key, 30), FormatPercent(parts[i].value/tot, 1), counts[i], plural(counts[i], "cell", "cells")))
		}
		more := ""
		if len(ranked) > 5 {
			more = fmt.Sprintf(" and %d more", len(ranked)-5)
		}
		t += fmt.Sprintf(" %s%s.", strings.Join(listed, ", "), more)
	}
	return t
}

// --- beeswarm --------------------------------------------------------------------------------------------

type swarmPoint struct {
	x    float64
	lane string
}

func swarmPoints(s spec, rows []row) []swarmPoint {
	var out []swarmPoint
	y := str(s, "y")
	for _, r := range rows {
		if x, ok := toNumber(r[str(s, "x")]); ok {
			lane := ""
			if y != "" {
				lane = orEmpty(r[y])
			}
			out = append(out, swarmPoint{x, lane})
		}
	}
	return out
}

func checkBeeswarm(s spec, rows []row, issues *[]Issue) {
	if len(swarmPoints(s, rows)) == 0 {
		issue(issues, "error", "no_points", "x", "No row has a numeric x.", "Pick a numeric column for x.")
	}
}

func describeBeeswarm(s spec) string {
	pts := swarmPoints(s, rowsOf(s))
	f := formatter(s)
	y := str(s, "y")
	names := make([]string, len(pts))
	for i, p := range pts {
		names[i] = p.lane
	}
	lanes := distinct(names)
	stat := func(lane string, every bool) (int, string) {
		var v []float64
		for _, p := range pts {
			if every || p.lane == lane {
				v = append(v, p.x)
			}
		}
		sort.Float64s(v)
		return len(v), fmt.Sprintf("median %s, range %s to %s", f(Quantile(v, 0.5)), f(v[0]), f(v[len(v)-1]))
	}
	t := fmt.Sprintf("%s %d %s of %s, one dot each", lead(s, "Beeswarm plot"), len(pts), plural(len(pts), "value", "values"), str(s, "x"))
	if y != "" {
		t += fmt.Sprintf(", in %d %s by %s (%s)", len(lanes), plural(len(lanes), "group", "groups"), y, fmtList(clipAll(lanes, 30), 5))
	}
	t += "."
	if len(pts) > 0 {
		_, all := stat("", true)
		t += fmt.Sprintf(" Overall %s.", all)
	}
	if y != "" && len(lanes) > 1 {
		for _, l := range lanes[:min(6, len(lanes))] {
			n, text := stat(l, false)
			t += fmt.Sprintf(" %s: %d %s, %s.", clip(l, 30), n, plural(n, "value", "values"), text)
		}
	}
	return t
}

// --- timeline --------------------------------------------------------------------------------------------

type timelineItem struct {
	lane, series, label string
	hasLabel            bool
	start, end          float64
}

type timeline struct {
	items              []timelineItem
	kind               string
	lanes, overlapping []string
	skipped, reversed  int
}

// timelineItems are the ranges of a timeline: one item per row with a start and an end in the same units.
// Mirrors timelineItems.
func timelineItems(s spec, rows []row) timeline {
	start, end := str(s, "start"), str(s, "end")
	both := make([]any, 0, 2*len(rows))
	for _, r := range rows {
		both = append(both, r[start], r[end])
	}
	d := timeline{kind: detectXKind(str(s, "xType"), both)}
	if d.kind != "category" {
		read := toNumber
		if d.kind == "time" {
			read = toTime
		}
		for _, r := range rows {
			a, aOK := read(r[start])
			b, bOK := read(r[end])
			if !aOK || !bOK {
				d.skipped++
				continue
			}
			if b < a {
				d.reversed++
				a, b = b, a
			}
			it := timelineItem{lane: keyString(r[str(s, "y")]), series: str(s, "y"), start: a, end: b}
			if c := str(s, "series"); c != "" {
				it.series = keyString(r[c])
			}
			if c := str(s, "label"); c != "" {
				it.label, it.hasLabel = clip(keyString(r[c]), 60), true
			}
			d.items = append(d.items, it)
		}
	}
	byLane := newOmap[[]timelineItem]()
	for _, it := range d.items {
		list, _ := byLane.get(it.lane)
		byLane.set(it.lane, append(list, it))
	}
	d.lanes = byLane.keys
	for _, lane := range byLane.keys {
		list := append([]timelineItem(nil), byLane.m[lane]...)
		sort.SliceStable(list, func(i, j int) bool {
			if list[i].start != list[j].start {
				return list[i].start < list[j].start
			}
			return list[i].end < list[j].end
		})
		reach := math.Inf(-1)
		for _, it := range list {
			if it.start < reach {
				d.overlapping = append(d.overlapping, lane)
				break
			}
			reach = math.Max(reach, it.end)
		}
	}
	return d
}

func checkTimeline(s spec, rows []row, issues *[]Issue) {
	d := timelineItems(s, rows)
	if d.kind == "category" {
		issue(issues, "error", "not_time_or_number", "start", fmt.Sprintf("%q and %q are not both dates or both numbers.", str(s, "start"), str(s, "end")), "Use ISO dates, timestamps, or plain numbers in both columns; set xType to say which.")
		return
	}
	if len(d.items) == 0 {
		issue(issues, "error", "no_ranges", "end", "No row has both a start and an end.", fmt.Sprintf("Fill %q and %q in the same units.", str(s, "start"), str(s, "end")))
		return
	}
	if d.skipped > 0 {
		issue(issues, "warning", "missing_range", "end", fmt.Sprintf("%d row(s) have no usable start or end and are skipped.", d.skipped), "Give both ends; for a point in time (a milestone) use the same value twice.")
	}
	if d.reversed > 0 {
		issue(issues, "warning", "range_reversed", "end", fmt.Sprintf("In %d row(s) the end is before the start; they were swapped.", d.reversed), "Check the column order: `start` is the earlier one.")
	}
	if limit := data.Limits["maxCategories"]; len(d.lanes) > limit {
		issue(issues, "warning", "too_many_lanes", "y", fmt.Sprintf("%d lanes; only the first %d are drawn.", len(d.lanes), limit), "Filter with `transform`, group lanes, or split the chart with `facet`.")
	}
	if n := len(d.overlapping); n > 0 {
		quoted := make([]string, n)
		for i, l := range d.overlapping {
			quoted[i] = fmt.Sprintf("\"%s\"", clip(l, 30))
		}
		issue(issues, "warning", "overlapping_ranges", "y", fmt.Sprintf("Bars overlap in %d %s (%s); a later bar covers part of an earlier one.", n, plural(n, "lane", "lanes"), fmtList(quoted, 3)), "Give overlapping items their own lane, e.g. one lane per task instead of per resource.")
	}
}

// describeTimeline reads dates in UTC: the reference's timeZone is a render option, not part of the spec.
func describeTimeline(s spec) string {
	d := timelineItems(s, rowsOf(s))
	if len(d.items) == 0 {
		return lead(s, "Timeline") + " No ranges."
	}
	time := d.kind == "time"
	f := formatter(s)
	intraday := false
	for _, it := range d.items {
		intraday = intraday || (time && (math.Mod(it.start, dayMs) != 0 || math.Mod(it.end, dayMs) != 0))
	}
	when := func(v float64) string {
		switch {
		case !time:
			return f(v)
		case intraday:
			return formatDateTime(v)
		}
		return formatDate(v)
	}
	long := func(it timelineItem) string {
		if time {
			return FormatDuration(it.end - it.start)
		}
		return f(it.end - it.start)
	}
	name := func(it timelineItem) string {
		if it.hasLabel {
			return clip(it.label, 40)
		}
		return clip(it.lane, 40)
	}
	first := firstMin(d.items, func(it timelineItem) float64 { return it.start })
	last := firstMax(d.items, func(it timelineItem) float64 { return it.end })
	longest := firstMax(d.items, func(it timelineItem) float64 { return it.end - it.start })
	coloured := ""
	if c := str(s, "series"); c != "" {
		names := make([]string, len(d.items))
		for i, it := range d.items {
			names[i] = it.series
		}
		coloured = fmt.Sprintf(", coloured by %s (%s)", c, fmtList(clipAll(distinct(names), 30), 5))
	}
	t := fmt.Sprintf("%s %d %s in %d %s (%s)%s, from %s to %s.", lead(s, "Timeline"), len(d.items), plural(len(d.items), "range", "ranges"), len(d.lanes), plural(len(d.lanes), "lane", "lanes"), fmtList(clipAll(d.lanes, 30), 5), coloured, when(first.start), when(last.end))
	t += fmt.Sprintf(" First: %s at %s. Last to end: %s at %s. Longest: %s (%s).", name(first), when(first.start), name(last), when(last.end), name(longest), long(longest))
	if n := len(d.overlapping); n > 0 {
		t += fmt.Sprintf(" Ranges overlap in %d %s.", n, plural(n, "lane", "lanes"))
	}
	if limit := data.Limits["maxCategories"]; len(d.lanes) > limit {
		t += fmt.Sprintf(" Only the first %d lanes are drawn.", limit)
	}
	return t
}
