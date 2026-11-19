package superplot

import "math"

// Row is one observation of the data: a flat JSON object.
type row = map[string]any

// omap is a string-keyed map that remembers insertion order, as a JavaScript Map does.
type omap[V any] struct {
	keys []string
	m    map[string]V
}

func newOmap[V any]() *omap[V] { return &omap[V]{m: map[string]V{}} }

func (o *omap[V]) get(k string) (V, bool) { v, ok := o.m[k]; return v, ok }

func (o *omap[V]) set(k string, v V) {
	if _, ok := o.m[k]; !ok {
		o.keys = append(o.keys, k)
	}
	o.m[k] = v
}

func (o *omap[V]) has(k string) bool { _, ok := o.m[k]; return ok }

// distinct returns values in order of first appearance.
func distinct(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := []string{}
	for _, v := range values {
		if _, ok := seen[v]; !ok {
			seen[v] = struct{}{}
			out = append(out, v)
		}
	}
	return out
}

type obs struct {
	x    any
	y    float64
	hasY bool
	s    string
}

// observations normalises y (one column, many columns, or a series column) into long-form observations.
func observations(rows []row, x string, y []string, series string) []obs {
	out := []obs{}
	for _, r := range rows {
		for _, col := range y {
			s := col
			if len(y) == 1 && series != "" {
				s = orEmpty(r[series])
			}
			var xv any = float64(len(out))
			if x != "" {
				xv = r[x]
			}
			yv, ok := toNumber(r[col])
			out = append(out, obs{x: xv, y: yv, hasY: ok, s: s})
		}
	}
	return out
}

func detectXKind(requested string, values []any) string {
	switch requested {
	case "category", "linear", "time":
		return requested
	}
	allNum, allTime, n := true, true, 0
	for _, v := range values {
		if v == nil {
			continue
		}
		if s, ok := v.(string); ok && s == "" {
			continue
		}
		n++
		f, isNum := v.(float64)
		if !isNum || !isFinite(f) {
			allNum = false
		}
		if _, ok := toTime(v); isNum || !ok {
			allTime = false
		}
		if !allNum && !allTime {
			break
		}
	}
	switch {
	case n == 0:
		return "category"
	case allNum:
		return "linear"
	case allTime:
		return "time"
	}
	return "category"
}

// matrix sums duplicates: category x series -> value. Missing stays absent.
func matrix(o []obs) *omap[*omap[float64]] {
	m := newOmap[*omap[float64]]()
	for _, ob := range o {
		if !ob.hasY {
			continue
		}
		k := keyString(ob.x)
		row, ok := m.get(k)
		if !ok {
			row = newOmap[float64]()
			m.set(k, row)
		}
		cur, _ := row.get(ob.s)
		row.set(ob.s, cur+ob.y)
	}
	return m
}

func (o *omap[V]) values() []V {
	out := make([]V, len(o.keys))
	for i, k := range o.keys {
		out[i] = o.m[k]
	}
	return out
}

var _ = math.Inf
