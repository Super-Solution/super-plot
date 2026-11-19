package superplot

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
)

// Check a plot spec without drawing it. Every problem comes back at once, each with a stable Code, a Path and a
// Hint that says how to fix it, so an agent can repair the spec in one round trip. The contract is the set of
// (Severity, Code, Path); wording may differ between languages. Field definitions are read from fields.v1.json,
// generated from the reference implementation.

// Issue is one problem found in a spec.
type Issue struct {
	Severity string `json:"severity"` // "error" or "warning"
	Code     string `json:"code"`     // stable, machine-readable
	Path     string `json:"path"`     // JSON path into the spec, e.g. "y" or "annotations[1].axis"
	Message  string `json:"message"`
	Hint     string `json:"hint,omitempty"`
}

// Validation is the result of ValidatePlot. Spec has defaults filled in and values normalised; it is set only when OK.
type Validation struct {
	OK     bool
	Issues []Issue
	Spec   map[string]any
}

// SpecError carries every issue of an invalid spec.
type SpecError struct{ Issues []Issue }

func (e *SpecError) Error() string {
	var parts []string
	for _, i := range e.Issues {
		if i.Severity != "error" {
			continue
		}
		p := i.Path
		if p == "" {
			p = "spec"
		}
		s := p + ": " + i.Message
		if i.Hint != "" {
			s += " " + i.Hint
		}
		parts = append(parts, s)
	}
	if len(parts) == 0 {
		return "Invalid plot spec"
	}
	return strings.Join(parts, "\n")
}

var (
	annotationKeys = []string{"axis", "value", "to", "label", "tone"}
	cameraKeys     = []string{"lng", "lat", "zoom", "pitch", "bearing"}
	tones          = []string{"neutral", "positive", "negative", "warning", "info"}
	hexRe          = regexp.MustCompile(`(?i)^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$`)
	funcRe         = regexp.MustCompile(`(?i)^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.%\s,/-]+\)$`)
	namedRe        = regexp.MustCompile(`(?i)^[a-z]{3,24}$`)
	varRe          = regexp.MustCompile(`(?i)^var\(\s*--[a-z0-9_-]+\s*(?:,\s*(?:#[0-9a-f]{3,8}|[a-z]{3,24})\s*)?\)$`)
)

var charts = func() map[string]map[string]fieldDef {
	out := map[string]map[string]fieldDef{}
	for _, c := range data.Charts {
		m := map[string]fieldDef{}
		for _, f := range c.Fields {
			m[f.Name] = f
		}
		out[c.Type] = m
	}
	return out
}()

// ChartTypes lists every chart type, in registration order.
func ChartTypes() []string {
	out := make([]string, len(data.Charts))
	for i, c := range data.Charts {
		out[i] = c.Type
	}
	return out
}

// IsSafeColor accepts only plain colour syntax: no url(), no ";", no quotes, nothing that could break out of an attribute.
func IsSafeColor(v any) bool {
	s, ok := v.(string)
	if !ok || ulen(s) > 64 {
		return false
	}
	t := jsTrim(s)
	return hexRe.MatchString(t) || funcRe.MatchString(t) || varRe.MatchString(t) || namedRe.MatchString(t)
}

func show(v any) string {
	b, err := json.Marshal(v)
	s := string(b)
	if err != nil {
		s = fmt.Sprint(v)
	}
	if r := []rune(s); len(r) > 60 {
		return string(r[:57]) + "…"
	}
	return s
}

func add(issues *[]Issue, severity, code, path, message string, hint ...string) {
	i := Issue{Severity: severity, Code: code, Path: path, Message: message}
	if len(hint) > 0 {
		i.Hint = hint[0]
	}
	*issues = append(*issues, i)
}

func isNumber(v any) bool { _, ok := v.(float64); return ok }

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func didYouMean(near string, ok bool) string {
	if ok {
		return fmt.Sprintf("Did you mean %q? ", near)
	}
	return ""
}

// geoState carries what the geo field needs and leaves behind: the spec as JSON text (a decoded object has lost
// its key order), and the geography the field resolved to.
type geoState struct {
	doc []byte
	geo *geography
}

// validateField returns the normalised value of one field, or nil to drop it.
func validateField(name string, d fieldDef, value any, issues *[]Issue, columns []string, rows []row, gs *geoState) any {
	bad := func(code, message string, hint ...string) any {
		add(issues, "error", code, name, message, hint...)
		return nil
	}
	switch d.Kind {
	case "version":
		if f, ok := value.(float64); ok && f == 1 {
			return 1.0
		}
		return bad("bad_value", fmt.Sprintf("version must be 1, got %s.", show(value)))
	case "data":
		return value
	case "string":
		s, ok := value.(string)
		if !ok {
			return bad("bad_type", fmt.Sprintf("%s must be a string, got %s.", name, show(value)))
		}
		limit := data.Limits["maxString"]
		if d.Max != nil {
			limit = int(*d.Max)
		}
		if ulen(s) > limit {
			add(issues, "warning", "string_truncated", name, fmt.Sprintf("%s is %d characters; it will be cut to %d.", name, ulen(s), limit))
			return uslice(s, limit)
		}
		return s
	case "boolean":
		if b, ok := value.(bool); ok {
			return b
		}
		return bad("bad_type", fmt.Sprintf("%s must be true or false, got %s.", name, show(value)))
	case "number":
		f, ok := value.(float64)
		if !ok || !isFinite(f) {
			return bad("bad_type", fmt.Sprintf("%s must be a number, got %s.", name, show(value)))
		}
		if d.Integer && f != math.Trunc(f) {
			return bad("bad_value", fmt.Sprintf("%s must be an integer, got %v.", name, f))
		}
		if d.Min != nil && f < *d.Min {
			return bad("out_of_range", fmt.Sprintf("%s must be at least %v, got %v.", name, *d.Min, f))
		}
		if d.Max != nil && f > *d.Max {
			return bad("out_of_range", fmt.Sprintf("%s must be at most %v, got %v.", name, *d.Max, f))
		}
		return f
	case "enum":
		if s, ok := value.(string); ok {
			if contains(d.Values, s) {
				return s
			}
			near, found := closest(s, d.Values)
			hint := ""
			if found {
				hint = fmt.Sprintf("Did you mean %q?", near)
			}
			return bad("bad_enum", fmt.Sprintf("%s must be one of %s; got %s.", name, strings.Join(d.Values, ", "), show(value)), hint)
		}
		return bad("bad_enum", fmt.Sprintf("%s must be one of %s; got %s.", name, strings.Join(d.Values, ", "), show(value)))
	case "format":
		if s, ok := value.(string); ok && IsValueFormat(s) {
			return s
		}
		return bad("bad_format", fmt.Sprintf("format %s is not recognised.", show(value)), "Use auto, compact, integer, percent, fixed:N (N is 0-20) or currency:USD.")
	case "bins":
		if s, ok := value.(string); ok && s == "auto" {
			return s
		}
		if f, ok := value.(float64); ok && f == math.Trunc(f) && f >= 1 && f <= 200 {
			return f
		}
		return bad("bad_value", fmt.Sprintf(`bins must be "auto" or an integer from 1 to 200, got %s.`, show(value)))
	case "domain":
		list, ok := value.([]any)
		if ok && len(list) == 2 {
			for _, v := range list {
				if f, isNum := v.(float64); v != nil && !(isNum && isFinite(f)) {
					ok = false
				}
			}
		} else {
			ok = false
		}
		if !ok {
			return bad("bad_value", fmt.Sprintf(`%s must be [min, max] with numbers or null for "automatic", got %s.`, name, show(value)))
		}
		lo, loOK := list[0].(float64)
		hi, hiOK := list[1].(float64)
		if loOK && hiOK && lo >= hi {
			return bad("bad_value", fmt.Sprintf("%s min must be below max.", name))
		}
		return list
	case "colors":
		m, ok := value.(map[string]any)
		if !ok {
			return bad("bad_type", "colors must be an object of name to colour.")
		}
		out := map[string]any{}
		for _, k := range sortedKeys(m) {
			if IsSafeColor(m[k]) {
				out[k] = jsTrim(m[k].(string))
			} else {
				add(issues, "error", "bad_color", "colors."+k, fmt.Sprintf("colors.%s is not a plain CSS colour: %s.", k, show(m[k])), "Use #RRGGBB, rgb(), hsl(), a colour name or var(--token). url() and other syntax are refused.")
			}
		}
		return out
	case "annotations":
		return validateAnnotations(name, value, issues)
	case "geo":
		_, isName := value.(string)
		if _, isObject := value.(map[string]any); !isName && !isObject {
			return bad("bad_type", "geo must be the name of a registered geography or an inline GeoJSON/TopoJSON object.", "Register boundaries with RegisterGeography(name, data) and set geo to that name.")
		}
		geo := resolveGeo(value, issues, name, func() []string { return keyOrder(gs.doc, name, "objects") })
		if geo == nil {
			return nil
		}
		gs.geo = geo
		return value
	case "camera":
		return validateCamera(name, value, issues)
	}
	// column / columns
	var names []any
	list, isList := value.([]any)
	if d.Kind == "columns" {
		if isList {
			names = list
		} else {
			names = []any{value}
		}
	} else {
		names = []any{value}
	}
	if _, ok := value.(string); d.Kind == "column" && !ok {
		return bad("bad_type", fmt.Sprintf("%s must be the name of a data column (a string), got %s.", name, show(value)))
	}
	allStrings := true
	for _, n := range names {
		if _, ok := n.(string); !ok {
			allStrings = false
		}
	}
	if (d.Kind == "columns" && !allStrings) || len(names) == 0 {
		return bad("bad_type", fmt.Sprintf("%s must be a column name or a non-empty array of column names.", name))
	}
	ok := true
	for i, n := range names {
		c := n.(string)
		path := name
		if isList {
			path = fmt.Sprintf("%s[%d]", name, i)
		}
		if !contains(columns, c) {
			ok = false
			near, found := closest(c, columns)
			avail := columns
			if len(avail) > 20 {
				avail = avail[:20]
			}
			add(issues, "error", "no_such_column", path, fmt.Sprintf("Column %q does not exist in data.", c), fmt.Sprintf("%sAvailable columns: %s.", didYouMean(near, found), strings.Join(avail, ", ")))
		} else if d.Role == "number" || d.Role == "lat" || d.Role == "lng" {
			lim := math.Inf(1)
			switch d.Role {
			case "lat":
				lim = 90
			case "lng":
				lim = 180
			}
			nonNum, seen, outside := 0, 0, 0
			for _, r := range rows {
				v := r[c]
				if v == nil {
					continue
				}
				if s, isStr := v.(string); isStr && s == "" {
					continue
				}
				seen++
				if num, isNum := toNumber(v); !isNum {
					nonNum++
				} else if math.Abs(num) > lim {
					outside++
				}
			}
			if seen > 0 && nonNum == seen {
				ok = false
				add(issues, "error", "not_numeric", path, fmt.Sprintf("Column %q has no numeric values.", c), "Convert the values to numbers, or pick another column.")
			} else {
				if nonNum > 0 {
					add(issues, "warning", "some_not_numeric", path, fmt.Sprintf("%d of %d values in %q are not numeric and will be skipped.", nonNum, seen, c))
				}
				if outside > 0 {
					what := "longitude (-180..180)"
					if d.Role == "lat" {
						what = "latitude (-90..90)"
					}
					if outside == seen-nonNum {
						ok = false
						add(issues, "error", "out_of_range", path, fmt.Sprintf("No value in %q is a valid %s.", c, what), "Use degrees in WGS 84. Projected coordinates (metres) are not supported.")
					} else {
						add(issues, "warning", "some_out_of_range", path, fmt.Sprintf("%d of %d values in %q are not a valid %s and will be skipped.", outside, seen, c, what))
					}
				}
			}
		}
	}
	if !ok {
		return nil
	}
	if d.Kind == "columns" {
		if len(names) == 1 && !isList {
			return names[0]
		}
		return names
	}
	return names[0]
}

func validateAnnotations(name string, value any, issues *[]Issue) any {
	list, ok := value.([]any)
	if !ok {
		add(issues, "error", "bad_type", name, "annotations must be an array.")
		return nil
	}
	if len(list) > data.Limits["maxAnnotations"] {
		add(issues, "error", "too_many", name, fmt.Sprintf("At most %d annotations.", data.Limits["maxAnnotations"]))
		return nil
	}
	out := []any{}
	for i, item := range list {
		p := fmt.Sprintf("annotations[%d]", i)
		a, ok := item.(map[string]any)
		if !ok {
			add(issues, "error", "bad_type", p, p+" must be an object.")
			continue
		}
		for _, k := range sortedKeys(a) {
			if !contains(annotationKeys, k) {
				add(issues, "error", "unknown_field", p+"."+k, fmt.Sprintf("Unknown annotation field %q.", k), "Allowed: "+strings.Join(annotationKeys, ", ")+".")
			}
		}
		isStrOrNum := func(v any) bool { _, s := v.(string); return s || isNumber(v) }
		axis, _ := a["axis"].(string)
		_, hasTo := a["to"]
		_, hasTone := a["tone"]
		_, hasLabel := a["label"]
		switch {
		case axis != "x" && axis != "y":
			add(issues, "error", "bad_enum", p+".axis", p+`.axis must be "x" or "y".`)
		case !isStrOrNum(a["value"]):
			add(issues, "error", "bad_type", p+".value", p+".value must be a number or a string.")
		case hasTo && a["to"] != nil && !isStrOrNum(a["to"]):
			add(issues, "error", "bad_type", p+".to", p+".to must be a number or a string.")
		case hasTone && a["tone"] != nil && !contains(tones, fmt.Sprint(a["tone"])):
			add(issues, "error", "bad_enum", p+".tone", p+".tone must be one of "+strings.Join(tones, ", ")+".")
		case hasLabel && a["label"] != nil && !isString(a["label"]):
			add(issues, "error", "bad_type", p+".label", p+".label must be a string.")
		default:
			c := map[string]any{}
			for k, v := range a {
				c[k] = v
			}
			if s, ok := a["label"].(string); ok {
				c["label"] = uslice(s, 80)
			}
			out = append(out, c)
		}
	}
	return out
}

func isString(v any) bool { _, ok := v.(string); return ok }

func validateCamera(name string, value any, issues *[]Issue) any {
	m, ok := value.(map[string]any)
	if !ok {
		add(issues, "error", "bad_type", name, `camera must be an object such as {"lng":121,"lat":24,"zoom":2}.`)
		return nil
	}
	out := map[string]any{}
	good := true
	for _, k := range sortedKeys(m) {
		p := name + "." + k
		limits, known := data.Camera[k]
		f, isNum := m[k].(float64)
		switch {
		case !known:
			hint := "Allowed: " + strings.Join(cameraKeys, ", ") + "."
			if near, found := closest(k, cameraKeys); found {
				hint = fmt.Sprintf("Did you mean %q?", near)
			}
			add(issues, "error", "unknown_field", p, fmt.Sprintf("Unknown camera field %q.", k), hint)
			good = false
		case !isNum || !isFinite(f):
			add(issues, "error", "bad_type", p, fmt.Sprintf("camera.%s must be a number, got %s.", k, show(m[k])))
			good = false
		case f < limits[0] || f > limits[1]:
			add(issues, "error", "out_of_range", p, fmt.Sprintf("camera.%s must be within %v..%v, got %v.", k, limits[0], limits[1], f))
			good = false
		default:
			out[k] = f
		}
	}
	if !good {
		return nil
	}
	return out
}

// normalize turns whatever the caller passed (a JSON string, bytes, a map, a struct) into plain JSON values,
// and also returns the JSON text they were read from.
func normalize(input any) (any, []byte, *Issue) {
	b, err := toJSON(input)
	if err != nil {
		return nil, nil, &Issue{Severity: "error", Code: "bad_type", Path: "", Message: "Spec must be an object."}
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, nil, &Issue{Severity: "error", Code: "invalid_json", Path: "", Message: fmt.Sprintf("Spec is not valid JSON: %v.", err)}
	}
	return out, b, nil
}

// ValidatePlot checks a spec (a JSON string, bytes, a map or a struct) without drawing it.
func ValidatePlot(input any) Validation {
	var issues []Issue
	fail := func(code, path, message string, hint ...string) Validation {
		add(&issues, "error", code, path, message, hint...)
		return Validation{Issues: issues}
	}
	raw, doc, bad := normalize(input)
	if bad != nil {
		return Validation{Issues: []Issue{*bad}}
	}
	obj, ok := raw.(map[string]any)
	if !ok {
		return fail("bad_type", "", "Spec must be an object.")
	}
	types := ChartTypes()
	chart, isStr := obj["type"].(string)
	if !isStr {
		return fail("missing_required", "type", `Missing "type".`, "Choose one of: "+strings.Join(types, ", ")+".")
	}
	defs, known := charts[chart]
	if !known {
		near, found := closest(chart, types)
		return fail("unknown_type", "type", fmt.Sprintf("Unknown chart type %q.", chart), didYouMean(near, found)+"Available: "+strings.Join(types, ", ")+".")
	}

	rowsAny, hasData := obj["data"]
	list, isList := rowsAny.([]any)
	switch {
	case !isList || len(list) == 0:
		code, msg := "empty_data", "data must be a non-empty array of row objects."
		if !hasData {
			code, msg = "missing_required", `Missing "data".`
		}
		add(&issues, "error", code, "data", msg, `Example: [{"region":"APAC","revenue":120}, ...]`)
	case len(list) > data.Limits["maxRows"]:
		add(&issues, "error", "too_many_rows", "data", fmt.Sprintf("data has %d rows; the limit is %d.", len(list), data.Limits["maxRows"]), "Aggregate or sample before plotting; a chart cannot show that many marks.")
	default:
		for _, r := range list {
			if _, ok := r.(map[string]any); !ok {
				add(&issues, "error", "bad_type", "data", "Every row of data must be an object.")
				break
			}
		}
	}
	dataOK := true
	for _, i := range issues {
		if i.Path == "data" && i.Severity == "error" {
			dataOK = false
		}
	}
	var columns []string
	var rows []row
	if dataOK {
		seen := map[string]bool{}
		for i, r := range list {
			m := r.(map[string]any)
			rows = append(rows, m)
			if i < 200 {
				for _, k := range sortedKeys(m) {
					if !seen[k] {
						seen[k] = true
						columns = append(columns, k)
					}
				}
			}
		}
	}

	fieldNames := make([]string, 0, len(defs))
	for _, c := range data.Charts {
		if c.Type == chart {
			for _, f := range c.Fields {
				fieldNames = append(fieldNames, f.Name)
			}
		}
	}
	out := map[string]any{"type": chart}
	gs := &geoState{doc: doc}
	for _, key := range sortedKeys(obj) {
		if key == "type" || key == "data" {
			continue
		}
		d, ok := defs[key]
		if !ok {
			near, found := closest(key, fieldNames)
			hint := "Allowed: " + strings.Join(fieldNames, ", ") + "."
			if found {
				hint = fmt.Sprintf("Did you mean %q?", near)
			}
			add(&issues, "error", "unknown_field", key, fmt.Sprintf("Unknown field %q for a %s chart.", key, chart), hint)
			continue
		}
		if (d.Kind == "column" || d.Kind == "columns") && !dataOK {
			continue
		}
		if v := validateField(key, d, obj[key], &issues, columns, rows, gs); v != nil {
			out[key] = v
		}
	}
	for _, key := range fieldNames {
		d := defs[key]
		if _, done := out[key]; done || key == "type" || key == "data" {
			continue
		}
		if _, given := obj[key]; d.Required && !given {
			add(&issues, "error", "missing_required", key, fmt.Sprintf("Missing required field %q: %s", key, d.Desc), fmt.Sprintf("See the %q example in the catalog.", chart))
		} else if d.Default != nil {
			out[key] = d.Default
		}
	}
	if dataOK {
		out["data"] = rowsAny
	}
	hasError := func() bool {
		for _, i := range issues {
			if i.Severity == "error" {
				return true
			}
		}
		return false
	}
	if !hasError() {
		if check, ok := checks[chart]; ok {
			check(out, rows, &issues)
		} else if check, ok := mapChecks[chart]; ok {
			check(out, rows, &issues, gs.geo)
		}
	}
	if hasError() {
		return Validation{Issues: issues}
	}
	return Validation{OK: true, Issues: issues, Spec: out}
}

// RequireValid returns the normalised spec, or a *SpecError with every issue.
func RequireValid(input any) (map[string]any, error) {
	v := ValidatePlot(input)
	if !v.OK {
		return nil, &SpecError{Issues: v.Issues}
	}
	return v.Spec, nil
}

// DescribePlot is a plain-language reading of a chart: what it shows and its headline numbers (also its alt text).
// It returns a *SpecError when the spec is invalid.
func DescribePlot(input any) (string, error) {
	spec, err := RequireValid(input)
	if err != nil {
		return "", err
	}
	if d, ok := spec["description"].(string); ok && d != "" {
		return d, nil
	}
	return describers[spec["type"].(string)](spec), nil
}
