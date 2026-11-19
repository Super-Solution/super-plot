package superplot

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
)

// transform: a short list of data steps that run before the chart reads its columns. It mirrors
// packages/core/src/transform.ts. Steps are plain JSON and run in order; the output of each step is the input of
// the next, and each step is checked against the columns the step before it left:
//
//	{"filter":    {"field": "region", "oneOf": ["APAC", "EMEA"]}}
//	{"filter":    {"field": "date", "range": ["2026-01-01", "2026-07-01"]}}    from inclusive, to exclusive
//	{"timeUnit":  {"field": "date", "unit": "month", "as": "month"}}
//	{"aggregate": {"groupBy": ["month", "region"], "fields": {"revenue": "sum"}, "count": "orders"}}
//	{"sort":      {"field": "revenue", "order": "descending"}}
//	{"top":       {"n": 10, "by": "revenue"}}
//
// The first invalid step stops the run (later steps cannot be checked without its output).

// TransformLimit is the most steps a transform may have.
const TransformLimit = 10

var (
	// TransformOps are the step kinds, TimeUnits the buckets of timeUnit, AggregateOps the operations of aggregate.
	TransformOps = []string{"filter", "timeUnit", "aggregate", "sort", "top"}
	TimeUnits    = []string{"year", "quarter", "month", "week", "day", "hour"}
	AggregateOps = []string{"sum", "mean", "median", "min", "max", "count", "distinct"}

	filterKeys    = []string{"field", "equal", "oneOf", "range", "gt", "gte", "lt", "lte", "valid"}
	transformKeys = map[string][]string{"filter": filterKeys, "timeUnit": {"field", "unit", "as"}, "aggregate": {"groupBy", "fields", "count"}, "sort": {"field", "order"}, "top": {"n", "by"}}
)

// ordinal is a row value or bound as a number: numbers first, then ISO dates (epoch ms). Mirrors ordinal.
func ordinal(v any) (float64, bool) {
	if n, ok := toNumber(v); ok {
		return n, true
	}
	return toTime(v)
}

func isScalar(v any) bool {
	switch v.(type) {
	case nil, string, float64, bool:
		return true
	}
	return false
}

func isBound(v any) bool {
	switch x := v.(type) {
	case float64:
		return isFinite(x)
	case string:
		_, ok := ordinal(x)
		return ok
	}
	return false
}

func isEmptyString(v any) bool {
	s, ok := v.(string)
	return ok && s == ""
}

func isName(v any) bool {
	s, ok := v.(string)
	return ok && s != "" && ulen(s) <= 64
}

// cellText is String(r[key]): a missing key reads "undefined".
func cellText(r row, key string) string {
	v, ok := r[key]
	if !ok {
		return "undefined"
	}
	return jsString(v)
}

// columnsOf lists the column names of the first 200 rows. Mirrors columnsOf (a decoded row has no key order, so
// each row's names come sorted).
func columnsOf(rows []row) []string {
	var out []string
	seen := map[string]bool{}
	for i, r := range rows {
		if i == 200 {
			break
		}
		for _, k := range sortedKeys(r) {
			if !seen[k] {
				seen[k] = true
				out = append(out, k)
			}
		}
	}
	return out
}

// ApplyTransform runs transform steps (a JSON string or bytes, or decoded steps) over rows, as ValidatePlot does
// before a chart reads its columns. ok is false when a step is invalid; the issues say why (and carry warnings).
func ApplyTransform(steps any, rows []map[string]any) (out []map[string]any, issues []Issue, ok bool) {
	value, doc, bad := normalize(steps)
	if bad != nil {
		return nil, []Issue{*bad}, false
	}
	out, ok = applyTransform(value, doc, rows, &issues, "transform")
	return out, issues, ok
}

// applyTransform checks the steps against the columns they will see and runs them. Mirrors applyTransform.
// ok is false when a step is invalid (the issues say why). raw is the JSON text of value, for the order of keys.
func applyTransform(value any, raw json.RawMessage, rows []row, issues *[]Issue, path string) (out []row, ok bool) {
	fail := func(p, code, message string, hint ...string) ([]row, bool) {
		add(issues, "error", code, p, message, hint...)
		return nil, false
	}
	steps, isList := value.([]any)
	if !isList {
		return fail(path, "bad_type", "transform must be an array of steps.", `Example: [{"filter":{"field":"region","oneOf":["APAC"]}}]`)
	}
	if len(steps) > TransformLimit {
		return fail(path, "too_many", fmt.Sprintf("At most %d transform steps; got %d.", TransformLimit, len(steps)))
	}
	rawSteps := rawList(raw)
	if len(rawSteps) != len(steps) {
		rawSteps = make([]json.RawMessage, len(steps))
	}
	cur := rows
	columns := columnsOf(rows)
	noColumn := func(p, name string) ([]row, bool) {
		near, found := closest(name, columns)
		listed := columns
		if len(listed) > 20 {
			listed = listed[:20]
		}
		return fail(p, "no_such_column", fmt.Sprintf("Column %q does not exist at this step.", name), didYouMean(near, found)+"Columns here: "+strings.Join(listed, ", ")+".")
	}
	suggest := func(word any, among []string) []string {
		if s, isStr := word.(string); isStr {
			if near, found := closest(s, among); found {
				return []string{fmt.Sprintf("Did you mean %q?", near)}
			}
		}
		return nil
	}
	for i, item := range steps {
		p := fmt.Sprintf("%s[%d]", path, i)
		step, isObj := item.(map[string]any)
		if !isObj {
			return fail(p, "bad_type", p+" must be an object with one key: "+strings.Join(TransformOps, ", ")+".")
		}
		keys := jsKeys(step, rawSteps[i])
		if len(keys) != 1 || !contains(TransformOps, keys[0]) {
			got := "nothing"
			var hint []string
			if len(keys) > 0 {
				got = strings.Join(keys, ", ")
			}
			if len(keys) == 1 {
				hint = suggest(keys[0], TransformOps)
			}
			return fail(p, "bad_transform", fmt.Sprintf("%s must have exactly one of %s; got %s.", p, strings.Join(TransformOps, ", "), got), hint...)
		}
		op := keys[0]
		bp := p + "." + op
		b, isObj := step[op].(map[string]any)
		if !isObj {
			return fail(bp, "bad_type", bp+" must be an object.")
		}
		rawBody := rawKey(rawSteps[i], op)
		for _, k := range jsKeys(b, rawBody) {
			if !contains(transformKeys[op], k) {
				hint := suggest(k, transformKeys[op])
				if hint == nil {
					hint = []string{"Allowed: " + strings.Join(transformKeys[op], ", ") + "."}
				}
				return fail(bp+"."+k, "unknown_field", fmt.Sprintf("Unknown %s field %q.", op, k), hint...)
			}
		}
		// column reads a column name of the step; good is false after an issue.
		column := func(k string) (name string, good bool) {
			v, given := b[k]
			if !given {
				fail(bp+"."+k, "missing_required", fmt.Sprintf("%s needs %q (a column name).", bp, k))
				return "", false
			}
			s, isStr := v.(string)
			if !isStr {
				fail(bp+"."+k, "bad_type", fmt.Sprintf("%s.%s must be a column name, got %s.", bp, k, show(v)))
				return "", false
			}
			if !contains(columns, s) {
				noColumn(bp+"."+k, s)
				return "", false
			}
			return s, true
		}
		switch op {
		case "filter":
			if _, good := column("field"); !good {
				return nil, false
			}
			tests := 0
			for _, k := range filterKeys[1:] {
				if _, given := b[k]; given {
					tests++
				}
			}
			if tests == 0 {
				return fail(bp, "missing_required", bp+" needs a test: equal, oneOf, range, gt, gte, lt, lte or valid.")
			}
			if v, given := b["equal"]; given && !isScalar(v) {
				return fail(bp+".equal", "bad_type", bp+".equal must be a string, number, boolean or null.")
			}
			if v, given := b["oneOf"]; given {
				list, isList := v.([]any)
				good := isList && len(list) <= 1000
				for _, e := range list {
					good = good && isScalar(e)
				}
				if !good {
					return fail(bp+".oneOf", "bad_type", bp+".oneOf must be an array of at most 1000 strings, numbers, booleans or nulls.")
				}
			}
			if v, given := b["range"]; given {
				r, isList := v.([]any)
				good := isList && len(r) == 2
				for _, e := range r {
					good = good && (e == nil || isBound(e))
				}
				if !good {
					return fail(bp+".range", "bad_value", fmt.Sprintf("%s.range must be [from, to]: numbers, ISO dates or null (open); got %s.", bp, show(v)))
				}
				lo, _ := ordinal(r[0])
				hi, _ := ordinal(r[1])
				if r[0] != nil && r[1] != nil && lo > hi {
					return fail(bp+".range", "bad_value", bp+".range from must not be after to.")
				}
			}
			for _, k := range []string{"gt", "gte", "lt", "lte"} {
				if v, given := b[k]; given && !isBound(v) {
					return fail(bp+"."+k, "bad_value", fmt.Sprintf("%s.%s must be a number or an ISO date, got %s.", bp, k, show(v)))
				}
			}
			if v, given := b["valid"]; given {
				if _, isBool := v.(bool); !isBool {
					return fail(bp+".valid", "bad_type", bp+".valid must be true or false.")
				}
			}
			keep := filterRow(b)
			kept := []row{}
			for _, r := range cur {
				if keep(r) {
					kept = append(kept, r)
				}
			}
			cur = kept
		case "timeUnit":
			field, good := column("field")
			if !good {
				return nil, false
			}
			unit, _ := b["unit"].(string)
			if !contains(TimeUnits, unit) {
				return fail(bp+".unit", "bad_enum", fmt.Sprintf("%s.unit must be one of %s; got %s.", bp, strings.Join(TimeUnits, ", "), show(b["unit"])), suggest(b["unit"], TimeUnits)...)
			}
			target := field
			if v, given := b["as"]; given {
				if !isName(v) {
					return fail(bp+".as", "bad_type", bp+".as must be a column name of 1 to 64 characters.")
				}
				target = v.(string)
			}
			bad := 0
			next := make([]row, len(cur))
			for j, r := range cur {
				c := make(row, len(r)+1)
				for k, v := range r {
					c[k] = v
				}
				if t, isTime := toTime(r[field]); isTime && t >= MinTime && t <= MaxTime {
					c[target] = TimeBucket(t, unit)
				} else {
					c[target] = nil
					bad++
				}
				next[j] = c
			}
			cur = next
			if len(cur) > 0 && bad == len(cur) {
				return fail(bp+".field", "not_time", fmt.Sprintf("Column %q has no dates (ISO 8601 strings or epoch milliseconds, years 1 to 9999).", field))
			}
			if bad > 0 {
				add(issues, "warning", "some_not_time", bp+".field", fmt.Sprintf("%d of %d values in %q are not dates (or fall outside years 1 to 9999); they become null.", bad, len(cur), field))
			}
			if !contains(columns, target) {
				columns = append(append([]string(nil), columns...), target)
			}
		case "aggregate":
			var groupBy []string
			if v := b["groupBy"]; v != nil {
				list, isList := v.([]any)
				good := isList && len(list) <= 4
				for _, e := range list {
					s, isStr := e.(string)
					good = good && isStr
					groupBy = append(groupBy, s)
				}
				if !good {
					return fail(bp+".groupBy", "bad_type", bp+".groupBy must be an array of at most 4 column names.")
				}
			}
			for gi, g := range groupBy {
				if !contains(columns, g) {
					return noColumn(fmt.Sprintf("%s.groupBy[%d]", bp, gi), g)
				}
			}
			fields := map[string]any{}
			if v := b["fields"]; v != nil {
				m, isObj := v.(map[string]any)
				if !isObj {
					return fail(bp+".fields", "bad_type", bp+`.fields must be an object of column to operation, e.g. {"revenue":"sum"}.`)
				}
				fields = m
			}
			names := jsKeys(fields, rawKey(rawBody, "fields"))
			ops := make([]string, len(names))
			for j, col := range names {
				if !contains(columns, col) {
					return fail(bp+".fields."+col, "no_such_column", fmt.Sprintf("Column %q does not exist at this step.", col), suggest(col, columns)...)
				}
				o, _ := fields[col].(string)
				if !contains(AggregateOps, o) {
					return fail(bp+".fields."+col, "bad_enum", fmt.Sprintf("%s.fields.%s must be one of %s; got %s.", bp, col, strings.Join(AggregateOps, ", "), show(fields[col])), suggest(fields[col], AggregateOps)...)
				}
				ops[j] = o
			}
			count := ""
			if v, given := b["count"]; given {
				if !isName(v) {
					return fail(bp+".count", "bad_type", bp+".count must be a column name of 1 to 64 characters.")
				}
				count = v.(string)
			}
			if len(names) == 0 && count == "" {
				return fail(bp, "missing_required", bp+` needs "fields" (e.g. {"revenue":"sum"}) or "count" (a name for the row count).`)
			}
			cur = aggregateRows(cur, groupBy, names, ops, count)
			columns = append(append([]string(nil), groupBy...), names...)
			if count != "" {
				columns = append(columns, count)
			}
			columns = distinct(columns)
		case "sort":
			field, good := column("field")
			if !good {
				return nil, false
			}
			order, given := b["order"]
			if given && order != "ascending" && order != "descending" {
				return fail(bp+".order", "bad_enum", bp+`.order must be "ascending" or "descending".`)
			}
			cur = sortRows(cur, field, order == "descending")
		case "top":
			by, good := column("by")
			if !good {
				return nil, false
			}
			n, isNum := b["n"].(float64)
			if !isNum || !isFinite(n) || n != math.Trunc(n) || n < 1 || n > 1000 {
				return fail(bp+".n", "bad_value", fmt.Sprintf("%s.n must be an integer from 1 to 1000, got %s.", bp, show(b["n"])))
			}
			cur = sortRows(cur, by, true)
			if len(cur) > int(n) {
				cur = cur[:int(n)]
			}
		}
	}
	return cur, true
}

// filterRow is the predicate for one filter step (every test given must hold). Mirrors filterRow.
func filterRow(f map[string]any) func(row) bool {
	field, _ := f["field"].(string)
	bound := func(v any) (float64, bool) {
		if v == nil {
			return 0, false
		}
		return ordinal(v)
	}
	rng, hasRange := f["range"].([]any)
	var lo, hi float64
	var hasLo, hasHi bool
	if hasRange && len(rng) == 2 {
		lo, hasLo = bound(rng[0])
		hi, hasHi = bound(rng[1])
	}
	gt, hasGt := bound(f["gt"])
	gte, hasGte := bound(f["gte"])
	lt, hasLt := bound(f["lt"])
	lte, hasLte := bound(f["lte"])
	var one map[string]bool
	if list, given := f["oneOf"].([]any); given {
		one = map[string]bool{}
		for _, v := range list {
			one[jsString(v)] = true
		}
	}
	equalValue, hasEqual := f["equal"]
	equal := jsString(equalValue)
	valid, hasValid := f["valid"].(bool)
	numeric := hasRange || hasGt || hasGte || hasLt || hasLte
	return func(r row) bool {
		v := r[field]
		if hasValid {
			missing := v == nil
			if s, isStr := v.(string); isStr && s == "" {
				missing = true
			}
			if n, isNum := v.(float64); isNum && !isFinite(n) {
				missing = true
			}
			if valid == missing {
				return false
			}
		}
		if hasEqual && cellText(r, field) != equal {
			return false
		}
		if one != nil && !one[cellText(r, field)] {
			return false
		}
		if numeric {
			n, isNum := ordinal(v)
			switch {
			case !isNum, hasLo && n < lo, hasHi && n >= hi, hasGt && !(n > gt), hasGte && !(n >= gte), hasLt && !(n < lt), hasLte && !(n <= lte):
				return false
			}
		}
		return true
	}
}

// aggregateRows gives one row per distinct combination of the groupBy values, in order of first appearance.
// Mirrors aggregate.
func aggregateRows(rows []row, groupBy, names, ops []string, count string) []row {
	groups := newOmap[[]row]()
	for _, r := range rows {
		var key strings.Builder
		for _, g := range groupBy {
			jsonKey(&key, r[g])
			key.WriteByte(',')
		}
		members, _ := groups.get(key.String())
		groups.set(key.String(), append(members, r))
	}
	out := make([]row, 0, len(groups.keys))
	for _, members := range groups.values() {
		r := row{}
		for _, k := range groupBy {
			r[k] = members[0][k]
		}
		for j, col := range names {
			r[col] = reduceRows(members, col, ops[j])
		}
		if count != "" {
			r[count] = float64(len(members))
		}
		out = append(out, r)
	}
	return out
}

// reduceRows mirrors reduce: count and distinct look at non-empty cells, the rest at numeric ones (null when none).
func reduceRows(rows []row, col, op string) any {
	if op == "count" || op == "distinct" {
		n := 0
		seen := map[string]bool{}
		for _, r := range rows {
			if v := r[col]; v != nil && !isEmptyString(v) {
				n++
				seen[jsString(v)] = true
			}
		}
		if op == "distinct" {
			return float64(len(seen))
		}
		return float64(n)
	}
	var nums []float64
	for _, r := range rows {
		if n, ok := toNumber(r[col]); ok {
			nums = append(nums, n)
		}
	}
	if len(nums) == 0 {
		return nil
	}
	switch op {
	case "sum", "mean":
		s := 0.0
		for _, n := range nums {
			s += n
		}
		if op == "mean" {
			return s / float64(len(nums))
		}
		return s
	case "min", "max":
		m := nums[0]
		for _, n := range nums[1:] {
			if (op == "min" && n < m) || (op == "max" && n > m) {
				m = n
			}
		}
		return m
	}
	sort.Float64s(nums)
	mid := len(nums) / 2
	if len(nums)%2 == 1 {
		return nums[mid]
	}
	return (nums[mid-1] + nums[mid]) / 2
}

// sortRows is a stable sort: numbers and dates by value, everything else as text; missing values last.
// Mirrors sortRows.
func sortRows(rows []row, field string, desc bool) []row {
	type keyed struct {
		r      row
		i      int
		n      float64
		hasN   bool
		s      string
		absent bool
	}
	ks := make([]keyed, len(rows))
	for i, r := range rows {
		v := r[field]
		k := keyed{r: r, i: i, absent: v == nil}
		k.n, k.hasN = ordinal(v)
		if !k.absent {
			k.s = jsString(v)
		}
		ks[i] = k
	}
	sort.Slice(ks, func(x, y int) bool {
		a, b := ks[x], ks[y]
		if a.absent || b.absent {
			if a.absent == b.absent {
				return a.i < b.i
			}
			return b.absent
		}
		c := 0
		switch {
		case a.hasN && b.hasN:
			if a.n < b.n {
				c = -1
			} else if a.n > b.n {
				c = 1
			}
		case a.hasN:
			c = -1
		case b.hasN:
			c = 1
		default:
			c = utf16Compare(a.s, b.s)
		}
		if desc {
			c = -c
		}
		if c == 0 {
			return a.i < b.i
		}
		return c < 0
	})
	out := make([]row, len(ks))
	for i, k := range ks {
		out[i] = k.r
	}
	return out
}
