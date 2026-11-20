// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
package superplot

// What a card reference points at in a plot: a port of resolveRef (packages/core/src/resolve.ts). The rules are in
// that function's doc comment; conformance/plot.v1.json (refCases, datePeriods) pins the whole answer, label and
// reason text included. Which columns x, y and series read comes from each chart's "ref" entry in fields.v1.json.

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// RefParams are the names a plot reference reads. Anything else is ref_param_unknown.
var RefParams = []string{"key", "x", "y", "series"}

type refShape struct {
	X      []string `json:"x"`
	Y      []string `json:"y"`
	YRow   bool     `json:"yRow"`
	Extra  []string `json:"extra"`
	Series string   `json:"series"`
	Legend string   `json:"legend"`
	Span   []string `json:"span"`
}

// RefPoint is one matched data point: its row, and its series where one row draws several (wide form).
type RefPoint struct {
	Row    int     `json:"row"`
	Series *string `json:"series,omitempty"`
}

// RefMatch is what a reference matched (OK), or why it matched nothing (Code, Reason, and Series for
// ref_hidden_series). Its JSON is the same as the TypeScript RefMatch.
type RefMatch struct {
	OK     bool
	Rows   []int
	Points []RefPoint
	// Series are the legend entries of the matched points; for ref_hidden_series the hidden ones.
	Series []string
	Keys   []string
	Label  string
	Code   string
	Reason string
}

// MarshalJSON writes the TypeScript shape: {ok: true, rows, points, series, keys, label} or {ok: false, code, reason, series?}.
func (m RefMatch) MarshalJSON() ([]byte, error) {
	if !m.OK {
		out := map[string]any{"ok": false, "code": m.Code, "reason": m.Reason}
		if m.Series != nil {
			out["series"] = m.Series
		}
		return json.Marshal(out)
	}
	nz := func(s []string) []string {
		if s == nil {
			return []string{}
		}
		return s
	}
	rows, points := m.Rows, m.Points
	if rows == nil {
		rows = []int{}
	}
	if points == nil {
		points = []RefPoint{}
	}
	return json.Marshal(map[string]any{"ok": true, "rows": rows, "points": points, "series": nz(m.Series), "keys": nz(m.Keys), "label": m.Label})
}

var (
	refDecimalRe = regexp.MustCompile(`^-?[0-9]+(?:\.[0-9]+)?$`)
	refPrefixRe  = regexp.MustCompile(`^([0-9]{4})(?:-([0-9]{2})(?:-([0-9]{2})(?:T([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?Z?)?)?)?$`)
	refShapes    = func() map[string]refShape {
		out := map[string]refShape{}
		for _, c := range data.Charts {
			out[c.Type] = c.Ref
		}
		return out
	}()
)

const refDay = 86_400_000

func leapYear(y int) bool { return y%4 == 0 && (y%100 != 0 || y%400 == 0) }

// DatePeriod reads a date written as a prefix of ISO 8601 as the closed interval of the whole period it names
// (epoch ms); ok is false when it is not one.
func DatePeriod(value string) (lo, hi float64, ok bool) {
	m := refPrefixRe.FindStringSubmatch(value)
	if m == nil {
		t, ok := toTime(value)
		return t, t, ok
	}
	y, _ := strconv.Atoi(m[1])
	from := value
	if m[2] == "" {
		from = m[1] + "-01"
	}
	start, ok := toTime(from)
	if !ok {
		return 0, 0, false
	}
	var span float64
	switch {
	case m[2] == "":
		days := 365
		if leapYear(y) {
			days = 366
		}
		span = float64(days) * refDay
	case m[3] == "":
		mo, _ := strconv.Atoi(m[2])
		span = float64(daysIn(int64(y), int64(mo))) * refDay
	case m[4] == "":
		span = refDay
	case m[6] == "":
		span = 60_000
	default:
		span = 1000
	}
	return start, start + span - 1, true
}

type refWant struct {
	kind     int // 0 interval, 1 text, 2 category range
	lo, hi   float64
	text     string
	from, to string
}

func refFailure(code, reason string) RefMatch { return RefMatch{Code: code, Reason: reason} }

func refList(spec map[string]any, field string) []string {
	switch v := spec[field].(type) {
	case string:
		return []string{v}
	case []any:
		var out []string
		for _, c := range v {
			if s, ok := c.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

func refPresent(spec map[string]any, fields []string) []string {
	var out []string
	for _, f := range fields {
		out = append(out, refList(spec, f)...)
	}
	return out
}

func refEmpty(v any) bool {
	s, isStr := v.(string)
	return v == nil || (isStr && s == "")
}

func parseWant(value, kind string) (refWant, string) {
	dots := strings.Index(value, "..")
	if kind == "category" {
		if dots < 0 {
			return refWant{kind: 1, text: value}, ""
		}
		return refWant{kind: 2, from: value[:dots], to: value[dots+2:]}, ""
	}
	one := func(v string, end int) (float64, bool) {
		if v == "" {
			if end == 0 {
				return math.Inf(-1), true
			}
			return math.Inf(1), true
		}
		if kind == "time" {
			lo, hi, ok := DatePeriod(v)
			if end == 0 {
				return lo, ok
			}
			return hi, ok
		}
		if !refDecimalRe.MatchString(v) {
			return 0, false
		}
		f, err := strconv.ParseFloat(v, 64)
		return f, err == nil || math.IsInf(f, 0)
	}
	what := "a number or a range such as 10..20"
	if kind == "time" {
		what = "a date such as 2026, 2026-03 or 2026-03-01, or a range of them (2026-01..2026-03)"
	}
	left, right := value, value
	if dots >= 0 {
		left, right = value[:dots], value[dots+2:]
	}
	a, okA := one(left, 0)
	b, okB := one(right, 1)
	if !okA || !okB || (dots < 0 && value == "") {
		return refWant{}, fmt.Sprintf("%s is not %s.", jsQuote(clip(value, 40)), what)
	}
	if a > b {
		return refWant{}, fmt.Sprintf("%s starts after it ends.", jsQuote(clip(value, 40)))
	}
	return refWant{kind: 0, lo: a, hi: b}, ""
}

func indexOf(list []string, s string) int {
	for i, x := range list {
		if x == s {
			return i
		}
	}
	return -1
}

func refHit(cell any, wants []refWant, kind string, order func() []string) bool {
	if refEmpty(cell) {
		return false
	}
	text := keyString(cell)
	var n float64
	hasN := false
	switch kind {
	case "time":
		n, hasN = toTime(cell)
	case "category":
	default:
		n, hasN = toNumber(cell)
	}
	for _, w := range wants {
		switch w.kind {
		case 1:
			if text == w.text {
				return true
			}
		case 2:
			if text == w.from+".."+w.to {
				return true
			}
			o := order()
			a, b, i := indexOf(o, w.from), indexOf(o, w.to), indexOf(o, text)
			if a >= 0 && b >= 0 && i >= min(a, b) && i <= max(a, b) {
				return true
			}
		default:
			if hasN && n >= w.lo && n <= w.hi {
				return true
			}
		}
	}
	return false
}

// jsQuote is JavaScript's `"${s}"`: the text between plain double quotes, unescaped (Go's %q escapes).
func jsQuote(s string) string { return `"` + s + `"` }

type refPt struct {
	row    int
	s      string
	hasS   bool
	col    string
	series *string
}

// ResolveRef says what a reference (a `ref:` text, a CardRef, or its decoded JSON) points at in a plot spec. hidden
// are the series the viewer hid. See resolveRef in core for every rule.
func ResolveRef(spec any, ref any, hidden []string) RefMatch {
	var text string
	if s, isStr := ref.(string); isStr {
		text = s
	} else if link, ok := FormatCardRef(ref); ok {
		text = link
	} else {
		return refFailure("ref_invalid", fmt.Sprintf("Not a valid reference: a target of letters, digits, dot, underscore, colon or dash, and up to %d params of up to %d non-empty values each.", maxRefNames, maxRefValues))
	}
	parsed := ParseCardRef(text)
	if !parsed.OK {
		return refFailure("ref_invalid", parsed.Error)
	}
	params := parsed.Ref.Params
	v := ValidatePlot(spec)
	if !v.OK || v.Spec == nil {
		return refFailure("ref_spec_invalid", "The plot spec does not validate; validatePlot lists its issues.")
	}
	s := v.Spec
	chart, _ := s["type"].(string)
	shape := refShapes[chart]
	var rows []map[string]any
	if list, ok := s["data"].([]any); ok {
		for _, r := range list {
			m, _ := r.(map[string]any)
			rows = append(rows, m)
		}
	}
	names := make([]string, 0, len(params))
	for n := range params {
		names = append(names, n)
	}
	sort.Slice(names, func(i, j int) bool { return utf16Compare(names[i], names[j]) < 0 })
	xCols := refPresent(s, shape.X)
	var span []string
	if len(shape.Span) == 2 && len(refList(s, shape.Span[0])) > 0 && len(refList(s, shape.Span[1])) > 0 {
		span = []string{refList(s, shape.Span[0])[0], refList(s, shape.Span[1])[0]}
	}
	var yCols []string
	for _, f := range shape.Y {
		if l := refList(s, f); len(l) > 0 {
			yCols = l
			break
		}
	}
	var extra []string
	if !shape.YRow {
		for _, c := range refPresent(s, shape.Extra) {
			if indexOf(yCols, c) < 0 {
				extra = append(extra, c)
			}
		}
	}
	seriesCol, hasSeriesCol := "", false
	if shape.Series != "" {
		if l := refList(s, shape.Series); len(l) > 0 {
			seriesCol, hasSeriesCol = l[0], true
		}
	}
	legendCol, hasLegend := seriesCol, hasSeriesCol
	if !hasLegend && shape.Legend != "" {
		if l := refList(s, shape.Legend); len(l) > 0 {
			legendCol, hasLegend = l[0], true
		}
	}
	wide := !shape.YRow && len(yCols)+len(extra) > 1
	can := map[string]bool{"key": true, "x": len(xCols) > 0 || span != nil, "y": len(yCols) > 0, "series": hasLegend || wide}

	for _, name := range names {
		if indexOf(RefParams, name) < 0 {
			return refFailure("ref_param_unknown", fmt.Sprintf("%s is not something a plot reference names; use %s.", jsQuote(clip(name, 32)), strings.Join(RefParams, ", ")))
		}
		if !can[name] {
			var ok []string
			for _, n := range RefParams {
				if can[n] {
					ok = append(ok, n)
				}
			}
			return refFailure("ref_param_unsupported", fmt.Sprintf("This %s chart has nothing %s can name; it takes %s.", chart, jsQuote(name), strings.Join(ok, ", ")))
		}
	}

	kinds := map[string]string{}
	kindOf := func(col string) string {
		k, ok := kinds[col]
		if !ok {
			vals := make([]any, len(rows))
			for i, r := range rows {
				vals[i] = r[col]
			}
			k = detectXKind("", vals)
			kinds[col] = k
		}
		return k
	}
	orders := map[string][]string{}
	orderOf := func(col string) func() []string {
		return func() []string {
			o, ok := orders[col]
			if !ok {
				seen := map[string]bool{}
				o = []string{}
				for _, r := range rows {
					if refEmpty(r[col]) {
						continue
					}
					k := keyString(r[col])
					if !seen[k] {
						seen[k] = true
						o = append(o, k)
					}
				}
				orders[col] = o
			}
			return o
		}
	}
	wants := func(name, kind string) ([]refWant, string) {
		var out []refWant
		for _, value := range params[name] {
			w, why := parseWant(value, kind)
			if why != "" {
				return nil, name + ": " + why
			}
			out = append(out, w)
		}
		return out, ""
	}
	type colWant struct {
		col   string
		wants []refWant
		kind  string
	}
	rowFilter := func(name string, cols []string) (func(map[string]any) bool, string) {
		var per []colWant
		why := ""
		for _, c := range cols {
			k := kindOf(c)
			w, bad := wants(name, k)
			if bad != "" {
				if why == "" {
					why = bad
				}
			} else {
				per = append(per, colWant{c, w, k})
			}
		}
		if len(per) == 0 {
			return nil, why
		}
		return func(r map[string]any) bool {
			for _, p := range per {
				if refHit(r[p.col], p.wants, p.kind, orderOf(p.col)) {
					return true
				}
			}
			return false
		}, ""
	}

	var filters []func(map[string]any) bool
	keyVals, hasKey := params["key"]
	keySet := map[string]bool{}
	for _, k := range keyVals {
		keySet[k] = true
	}
	if hasKey {
		col, hasCol := s["key"].(string)
		filters = append(filters, func(r map[string]any) bool {
			return hasCol && keySet[keyString(r[col])] && !refEmpty(r[col])
		})
	}
	if _, ok := params["x"]; ok {
		if span != nil {
			k := "number"
			if kindOf(span[0]) == "time" || kindOf(span[1]) == "time" {
				k = "time"
			}
			w, bad := wants("x", k)
			if bad != "" {
				return refFailure("ref_bad_value", bad)
			}
			at := func(c any) (float64, bool) {
				if k == "time" {
					return toTime(c)
				}
				return toNumber(c)
			}
			filters = append(filters, func(r map[string]any) bool {
				a, okA := at(r[span[0]])
				b, okB := at(r[span[1]])
				if !okA || !okB {
					return false
				}
				for _, q := range w {
					if math.Min(a, b) <= q.hi && math.Max(a, b) >= q.lo {
						return true
					}
				}
				return false
			})
		} else {
			f, bad := rowFilter("x", xCols)
			if f == nil {
				return refFailure("ref_bad_value", bad)
			}
			filters = append(filters, f)
		}
	}
	var yPoint []refWant
	hasYPoint := false
	if _, ok := params["y"]; ok {
		if shape.YRow {
			f, bad := rowFilter("y", yCols)
			if f == nil {
				return refFailure("ref_bad_value", bad)
			}
			filters = append(filters, f)
		} else {
			w, bad := wants("y", "number")
			if bad != "" {
				return refFailure("ref_bad_value", bad)
			}
			yPoint, hasYPoint = w, true
		}
	}
	seriesVals, hasSeriesParam := params["series"]
	seriesSet := map[string]bool{}
	for _, x := range seriesVals {
		seriesSet[x] = true
	}
	hiddenSet := map[string]bool{}
	for _, h := range hidden {
		hiddenSet[h] = true
	}

	var points []refPt
	var valueCols []string
	if !shape.YRow {
		valueCols = append(append(valueCols, yCols...), extra...)
	}
	for i, r := range rows {
		pass := true
		for _, f := range filters {
			if !f(r) {
				pass = false
				break
			}
		}
		if !pass {
			continue
		}
		legend := ""
		if hasLegend {
			legend = keyString(r[legendCol])
		}
		if len(valueCols) == 0 {
			if hasSeriesParam && (!hasLegend || !seriesSet[legend]) {
				continue
			}
			points = append(points, refPt{row: i, s: legend, hasS: hasLegend})
			continue
		}
		for j, col := range valueCols {
			ser := legend
			if j >= len(yCols) || len(yCols) > 1 || !hasLegend {
				ser = col
			}
			if hasSeriesParam && !seriesSet[ser] {
				continue
			}
			if hasYPoint && !refHit(r[col], yPoint, "number", func() []string { return nil }) {
				continue
			}
			p := refPt{row: i, s: ser, hasS: true, col: col}
			if wide {
				x := ser
				p.series = &x
			}
			points = append(points, p)
		}
	}

	keys := []string{}
	if hasKey {
		anns, _ := s["annotations"].([]any)
		for _, a := range anns {
			m, _ := a.(map[string]any)
			if k, ok := m["key"].(string); ok && keySet[k] {
				keys = append(keys, k)
			}
		}
	}
	for _, n := range names {
		if n != "key" {
			keys = []string{}
			break
		}
	}
	var shown []refPt
	for _, p := range points {
		if !p.hasS || !hiddenSet[p.s] {
			shown = append(shown, p)
		}
	}
	if len(shown) == 0 && len(keys) == 0 {
		var gone []string
		seen := map[string]bool{}
		for _, p := range points {
			if p.hasS && !seen[p.s] {
				seen[p.s] = true
				gone = append(gone, p.s)
			}
		}
		if len(points) > 0 {
			quoted := make([]string, len(gone))
			for i, g := range gone {
				quoted[i] = jsQuote(clip(g, 40))
			}
			if gone == nil {
				gone = []string{}
			}
			return RefMatch{Code: "ref_hidden_series", Reason: fmt.Sprintf("What this names is in hidden series only: %s. Show the series to see it.", strings.Join(quoted, ", ")), Series: gone}
		}
		if len(names) > 0 {
			said := make([]string, len(names))
			for i, n := range names {
				vs := make([]string, len(params[n]))
				for j, x := range params[n] {
					vs[j] = clip(x, 40)
				}
				said[i] = n + "=" + strings.Join(vs, " or ")
			}
			return refFailure("ref_no_match", "Nothing in this plot matches "+strings.Join(said, " and ")+".")
		}
		return refFailure("ref_no_match", "This plot has no data to point at.")
	}
	rowSeen := map[int]bool{}
	var rowList []int
	series := []string{}
	serSeen := map[string]bool{}
	out := make([]RefPoint, len(shown))
	for i, p := range shown {
		if !rowSeen[p.row] {
			rowSeen[p.row] = true
			rowList = append(rowList, p.row)
		}
		if p.hasS && !serSeen[p.s] {
			serSeen[p.s] = true
			series = append(series, p.s)
		}
		out[i] = RefPoint{Row: p.row, Series: p.series}
	}
	sort.Ints(rowList)
	lane := ""
	hasLane := shape.YRow && len(yCols) > 0
	if hasLane {
		lane = yCols[0]
	}
	keyCol, hasKeyCol := s["key"].(string)
	return RefMatch{OK: true, Rows: rowList, Points: out, Series: series, Keys: keys,
		Label: refLabel(s, rows, shown, keys, xCols, span, lane, hasLane, seriesCol, hasSeriesCol && !wide, keyCol, hasKeyCol)}
}

func refLabel(s map[string]any, rows []map[string]any, pts []refPt, keys []string, xCols, span []string, lane string, hasLane bool, seriesCol string, hasSeriesCol bool, keyCol string, hasKeyCol bool) string {
	var parts []string
	one := func(col string, v any) string { return clip(col, 40) + " " + clip(keyString(v), 40) }
	if len(pts) == 1 {
		p := pts[0]
		r := rows[p.row]
		var bits []string
		if span != nil {
			bits = append(bits, one(span[0], r[span[0]]), one(span[1], r[span[1]]))
		} else if len(xCols) > 0 {
			bits = append(bits, one(xCols[0], r[xCols[0]]))
		}
		if hasLane {
			bits = append(bits, one(lane, r[lane]))
		}
		if hasSeriesCol {
			bits = append(bits, one(seriesCol, r[seriesCol]))
		}
		if p.col != "" {
			bits = append(bits, one(p.col, r[p.col]))
		}
		if len(bits) == 0 && hasKeyCol {
			bits = append(bits, one(keyCol, r[keyCol]))
		}
		if len(bits) > 0 {
			parts = append(parts, strings.Join(bits, ", "))
		} else {
			parts = append(parts, fmt.Sprintf("row %d", p.row+1))
		}
	} else if len(pts) > 1 {
		type sk struct {
			s    string
			hasS bool
		}
		distinctS := map[sk]bool{}
		for _, p := range pts {
			distinctS[sk{p.s, p.hasS}] = true
		}
		t := fmt.Sprintf("%d points", len(pts))
		if len(distinctS) > 1 {
			t += fmt.Sprintf(" in %d series", len(distinctS))
		}
		parts = append(parts, t)
	}
	if len(keys) == 1 {
		label := keys[0]
		anns, _ := s["annotations"].([]any)
		for _, a := range anns {
			m, _ := a.(map[string]any)
			if k, _ := m["key"].(string); k == keys[0] {
				if l, _ := m["label"].(string); l != "" {
					label = l
				}
				break
			}
		}
		parts = append(parts, "annotation "+jsQuote(clip(label, 40)))
	} else if len(keys) > 1 {
		parts = append(parts, fmt.Sprintf("%d annotations", len(keys)))
	}
	return clip(strings.Join(parts, "; "), 200)
}
