// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
package superplot

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"reflect"
	"sort"
	"testing"
)

// Runs the shared conformance data (conformance/plot.v1.json) against this implementation.

type issueKey struct {
	Severity string `json:"severity"`
	Code     string `json:"code"`
	Path     string `json:"path"`
}

type conformance struct {
	Version     int `json:"version"`
	LinearTicks []struct {
		In  [3]float64 `json:"in"`
		Out []float64  `json:"out"`
	} `json:"linearTicks"`
	NiceDomain []struct {
		In  [3]float64 `json:"in"`
		Out [2]float64 `json:"out"`
	} `json:"niceDomain"`
	Quantile []struct {
		In struct {
			Sorted []float64 `json:"sorted"`
			P      float64   `json:"p"`
		} `json:"in"`
		Out float64 `json:"out"`
	} `json:"quantile"`
	BoxStats []struct {
		In  []float64 `json:"in"`
		Out struct {
			N           int       `json:"n"`
			Min         float64   `json:"min"`
			Q1          float64   `json:"q1"`
			Median      float64   `json:"median"`
			Q3          float64   `json:"q3"`
			Max         float64   `json:"max"`
			Mean        float64   `json:"mean"`
			LowWhisker  float64   `json:"lowWhisker"`
			HighWhisker float64   `json:"highWhisker"`
			Outliers    []float64 `json:"outliers"`
		} `json:"out"`
	} `json:"boxStats"`
	HistogramBins []struct {
		In struct {
			Values []float64 `json:"values"`
			Bins   any       `json:"bins"`
		} `json:"in"`
		Out struct {
			Edges  []float64 `json:"edges"`
			Counts []int     `json:"counts"`
		} `json:"out"`
	} `json:"histogramBins"`
	ChartExamples []struct {
		Type       string         `json:"type"`
		Spec       map[string]any `json:"spec"`
		Valid      bool           `json:"valid"`
		IssueCodes []string       `json:"issueCodes"`
		Normalized map[string]any `json:"normalized"`
		Describe   *string        `json:"describe"`
	} `json:"chartExamples"`
	Density []struct {
		In struct {
			Values    []float64 `json:"values"`
			Bandwidth float64   `json:"bandwidth"`
		} `json:"in"`
		Out struct {
			Silverman float64   `json:"silverman"`
			Bandwidth float64   `json:"bandwidth"`
			Grid      []float64 `json:"grid"`
			Density   []float64 `json:"density"`
			Peaks     []float64 `json:"peaks"`
		} `json:"out"`
	} `json:"density"`
	LogTicks []struct {
		In  [3]float64 `json:"in"`
		Out []float64  `json:"out"`
	} `json:"logTicks"`
	LogNiceDomain []struct {
		In  [2]float64 `json:"in"`
		Out [2]float64 `json:"out"`
	} `json:"logNiceDomain"`
	Loess []struct {
		In struct {
			Xs        []float64 `json:"xs"`
			Ys        []float64 `json:"ys"`
			Bandwidth float64   `json:"bandwidth"`
			Grid      int       `json:"grid"`
		} `json:"in"`
		Out [][2]float64 `json:"out"`
	} `json:"loess"`
	BinStep []struct {
		In struct {
			Values  []float64 `json:"values"`
			Maxbins int       `json:"maxbins"`
			Step    float64   `json:"step"`
		} `json:"in"`
		Out []float64 `json:"out"`
	} `json:"binStep"`
	WaffleCells []struct {
		In struct {
			Values []float64 `json:"values"`
			Cells  int       `json:"cells"`
		} `json:"in"`
		Out []int `json:"out"`
	} `json:"waffleCells"`
	JitterUnit []struct {
		In struct {
			Index int    `json:"index"`
			Axis  string `json:"axis"`
		} `json:"in"`
		Out float64 `json:"out"`
	} `json:"jitterUnit"`
	CloudLayout []struct {
		In struct {
			Words  []CloudWord `json:"words"`
			Widths []float64   `json:"widths"`
			Width  float64     `json:"width"`
			Height float64     `json:"height"`
		} `json:"in"`
		Out []*CloudBox `json:"out"`
	} `json:"cloudLayout"`
	Geographies    []geoFixture `json:"geographies"`
	GeographyCases []struct {
		geoFixture
		As      string     `json:"as"`
		Preset  string     `json:"preset"`
		OK      bool       `json:"ok"`
		Issues  []issueKey `json:"issues"`
		Regions []struct {
			Key      string `json:"key"`
			Name     string `json:"name"`
			Disputed bool   `json:"disputed"`
		} `json:"regions"`
		Matches [][2]any `json:"matches"`
	} `json:"geographyCases"`
	BrokenSpecs     []validationCase `json:"brokenSpecs"`
	ValidationCases []validationCase `json:"validationCases"`
	Formats         []struct {
		In struct {
			Format string  `json:"format"`
			Value  float64 `json:"value"`
		} `json:"in"`
		Out string `json:"out"`
	} `json:"formats"`
	Percents []struct {
		In struct {
			Ratio  float64 `json:"ratio"`
			Digits int     `json:"digits"`
		} `json:"in"`
		Out string `json:"out"`
	} `json:"percents"`
	TransformCases []transformCase `json:"transformCases"`
	DescribeCases  []struct {
		Name       string   `json:"name"`
		Spec       any      `json:"spec"`
		Describe   *string  `json:"describe"`
		IssueCodes []string `json:"issueCodes"`
	} `json:"describeCases"`
}

// geoFixture is a geography to register. Data stays JSON text: the first object of a Topology is the first one
// written, and a decoded map has forgotten which that was.
type geoFixture struct {
	Name    string          `json:"name"`
	Data    json.RawMessage `json:"data"`
	Options struct {
		Object      string            `json:"object"`
		Key         string            `json:"key"`
		Name        string            `json:"name"`
		Disputed    string            `json:"disputed"`
		Aliases     map[string]string `json:"aliases"`
		Attribution string            `json:"attribution"`
	} `json:"options"`
}

func (g geoFixture) options() GeographyOptions {
	o := GeographyOptions{Object: g.Options.Object, Aliases: g.Options.Aliases, Attribution: g.Options.Attribution}
	if g.Options.Key != "" {
		o.Key = GeoProperty(g.Options.Key)
	}
	if g.Options.Name != "" {
		o.Name = GeoProperty(g.Options.Name)
	}
	if g.Options.Disputed != "" {
		o.Disputed = GeoProperty(g.Options.Disputed)
	}
	return o
}

// input is the fixture's data as a caller would pass it.
func (g geoFixture) input() any { return asGiven(g.Data) }

// asGiven is a case's input as a caller would pass it: the text itself for a JSON string, the document otherwise.
func asGiven(raw json.RawMessage) any {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	return []byte(raw)
}

type validationCase struct {
	Name   string          `json:"name"`
	Spec   json.RawMessage `json:"spec"`
	OK     bool            `json:"ok"`
	Issues []struct {
		Severity string `json:"severity"`
		Code     string `json:"code"`
		Path     string `json:"path"`
	} `json:"issues"`
	Normalized map[string]any `json:"normalized"`
}

func read() (conformance, error) {
	var c conformance
	b, err := os.ReadFile("../../../conformance/plot.v1.json")
	if err == nil {
		err = json.Unmarshal(b, &c)
	}
	return c, err
}

func load(t *testing.T) conformance {
	t.Helper()
	c, err := read()
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// TestMain registers the geographies that the validation and description cases name.
func TestMain(m *testing.M) {
	c, err := read()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	for _, g := range c.Geographies {
		if _, err := RegisterGeography(g.Name, g.input(), g.options()); err != nil {
			fmt.Fprintln(os.Stderr, g.Name, err)
			os.Exit(1)
		}
	}
	os.Exit(m.Run())
}

func near(a, b float64) bool {
	return a == b || math.Abs(a-b) <= 1e-9+1e-9*math.Abs(b)
}

func nums(t *testing.T, name string, got, want []float64) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s: got %v want %v", name, got, want)
	}
	for i := range got {
		if !near(got[i], want[i]) {
			t.Fatalf("%s: got %v want %v", name, got, want)
		}
	}
}

// same is deep equality with numbers compared to 1e-9.
func same(a, b any) bool {
	switch y := b.(type) {
	case float64:
		x, ok := a.(float64)
		return ok && near(x, y)
	case []any:
		x, ok := a.([]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for i := range x {
			if !same(x[i], y[i]) {
				return false
			}
		}
		return true
	case map[string]any:
		x, ok := a.(map[string]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for k, v := range y {
			av, ok := x[k]
			if !ok || !same(av, v) {
				return false
			}
		}
		return true
	}
	return reflect.DeepEqual(a, b)
}

func withoutData(m map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range m {
		if k != "data" {
			out[k] = v
		}
	}
	return out
}

func keyed(issues []Issue) []issueKey {
	out := make([]issueKey, len(issues))
	for i, x := range issues {
		out[i] = issueKey{x.Severity, x.Code, x.Path}
	}
	sort.Slice(out, func(i, j int) bool { return fmt.Sprint(out[i]) < fmt.Sprint(out[j]) })
	return out
}

func TestVersion(t *testing.T) {
	if load(t).Version != 1 {
		t.Fatal("unexpected conformance version")
	}
}

func TestTicksAndDomains(t *testing.T) {
	c := load(t)
	for _, x := range c.LinearTicks {
		nums(t, fmt.Sprint("ticks ", x.In), LinearTicks(x.In[0], x.In[1], x.In[2]), x.Out)
	}
	for _, x := range c.NiceDomain {
		lo, hi := NiceDomain(x.In[0], x.In[1], x.In[2])
		nums(t, fmt.Sprint("nice ", x.In), []float64{lo, hi}, x.Out[:])
	}
	for _, x := range c.Quantile {
		if got := Quantile(x.In.Sorted, x.In.P); !near(got, x.Out) {
			t.Fatalf("quantile %v: got %v want %v", x.In.P, got, x.Out)
		}
	}
}

func TestBoxStatsAndBins(t *testing.T) {
	c := load(t)
	for _, x := range c.BoxStats {
		got, ok := ComputeBoxStats(x.In)
		if !ok {
			t.Fatal("no stats")
		}
		want := x.Out
		if got.N != want.N || !near(got.Min, want.Min) || !near(got.Q1, want.Q1) || !near(got.Median, want.Median) || !near(got.Q3, want.Q3) ||
			!near(got.Max, want.Max) || !near(got.Mean, want.Mean) || !near(got.LowWhisker, want.LowWhisker) || !near(got.HighWhisker, want.HighWhisker) {
			t.Fatalf("box %v: got %+v want %+v", x.In, got, want)
		}
		nums(t, "outliers", got.Outliers, want.Outliers)
	}
	for _, x := range c.HistogramBins {
		bins := 0
		if f, ok := x.In.Bins.(float64); ok {
			bins = int(f)
		}
		edges := BinEdges(x.In.Values, bins, 0)
		nums(t, fmt.Sprint("edges ", x.In.Values), edges, x.Out.Edges)
		if !reflect.DeepEqual(BinCounts(x.In.Values, edges), x.Out.Counts) {
			t.Fatalf("counts %v: got %v want %v", x.In.Values, BinCounts(x.In.Values, edges), x.Out.Counts)
		}
	}
}

func TestFormats(t *testing.T) {
	c := load(t)
	for _, x := range c.Formats {
		if got := FormatValue(x.In.Value, x.In.Format); got != x.Out {
			t.Fatalf("format %s %v: got %q want %q", x.In.Format, x.In.Value, got, x.Out)
		}
	}
	for _, x := range c.Percents {
		if got := FormatPercent(x.In.Ratio, x.In.Digits); got != x.Out {
			t.Fatalf("percent %v/%d: got %q want %q", x.In.Ratio, x.In.Digits, got, x.Out)
		}
	}
}

func TestChartExamples(t *testing.T) {
	c := load(t)
	var types []string
	for _, x := range c.ChartExamples {
		types = append(types, x.Type)
		v := ValidatePlot(x.Spec)
		if v.OK != x.Valid {
			t.Fatalf("%s: ok=%v", x.Type, v.OK)
		}
		var codes []string
		for _, i := range v.Issues {
			codes = append(codes, i.Code)
		}
		if len(codes) != len(x.IssueCodes) {
			t.Fatalf("%s: issue codes %v want %v", x.Type, codes, x.IssueCodes)
		}
		if !same(withoutData(v.Spec), x.Normalized) {
			t.Fatalf("%s: normalized\n got %v\nwant %v", x.Type, withoutData(v.Spec), x.Normalized)
		}
		got, err := DescribePlot(x.Spec)
		if err != nil || x.Describe == nil || got != *x.Describe {
			t.Fatalf("%s: describe\n got %q (%v)\nwant %v", x.Type, got, err, x.Describe)
		}
	}
	if !reflect.DeepEqual(ChartTypes(), types) {
		t.Fatalf("chart types %v want %v", ChartTypes(), types)
	}
}

func runCases(t *testing.T, cases []validationCase) {
	for _, x := range cases {
		v := ValidatePlot(asGiven(x.Spec))
		if v.OK != x.OK {
			t.Fatalf("%s: ok=%v issues=%v", x.Name, v.OK, v.Issues)
		}
		var want []issueKey
		for _, i := range x.Issues {
			want = append(want, issueKey{i.Severity, i.Code, i.Path})
		}
		sort.Slice(want, func(i, j int) bool { return fmt.Sprint(want[i]) < fmt.Sprint(want[j]) })
		if !reflect.DeepEqual(keyed(v.Issues), append([]issueKey(nil), want...)) && !(len(want) == 0 && len(v.Issues) == 0) {
			t.Fatalf("%s: issues\n got %v\nwant %v", x.Name, keyed(v.Issues), want)
		}
		if x.OK && !same(withoutData(v.Spec), x.Normalized) {
			t.Fatalf("%s: normalized\n got %v\nwant %v", x.Name, withoutData(v.Spec), x.Normalized)
		}
		if !x.OK && v.Spec != nil {
			t.Fatalf("%s: spec set on an invalid result", x.Name)
		}
	}
}

func TestBrokenSpecs(t *testing.T)     { runCases(t, load(t).BrokenSpecs) }
func TestValidationCases(t *testing.T) { runCases(t, load(t).ValidationCases) }

// transformCase is a spec with a transform: besides the issues and the normalised spec, the rows the chart reads
// after the steps have run, and the description made from them.
type transformCase struct {
	validationCase
	Rows     []any   `json:"rows"`
	Describe *string `json:"describe"`
}

func TestTransformCases(t *testing.T) {
	var cases []validationCase
	all := load(t).TransformCases
	if len(all) == 0 {
		t.Fatal("no transform cases")
	}
	for _, x := range all {
		cases = append(cases, x.validationCase)
		v := ValidatePlot(asGiven(x.Spec))
		if !v.OK {
			continue
		}
		// Through JSON, as a caller would send the rows on.
		b, err := json.Marshal(v.Spec["data"])
		var rows any
		if err == nil {
			err = json.Unmarshal(b, &rows)
		}
		if err != nil || !same(rows, any(x.Rows)) {
			t.Fatalf("%s: rows\n got %s\nwant %v", x.Name, b, x.Rows)
		}
		got, err := DescribePlot(asGiven(x.Spec))
		if x.Describe == nil || err != nil || got != *x.Describe {
			t.Fatalf("%s: describe\n got %q (%v)\nwant %v", x.Name, got, err, x.Describe)
		}
	}
	runCases(t, cases)
}

func TestTransformAcceptsDecodedSpecs(t *testing.T) {
	// A decoded map has no key order; everything but "which of two bad keys is named" is the same.
	v := ValidatePlot(map[string]any{"type": "bar", "x": "m", "y": "v", "data": []any{map[string]any{"d": "2026-03-09", "v": 2.0}, map[string]any{"d": "2026-03-20", "v": 3.0}},
		"transform": []any{map[string]any{"timeUnit": map[string]any{"field": "d", "unit": "month", "as": "m"}}, map[string]any{"aggregate": map[string]any{"groupBy": []any{"m"}, "fields": map[string]any{"v": "sum"}}}}})
	rows, _ := v.Spec["data"].([]any)
	if !v.OK || len(rows) != 1 || !reflect.DeepEqual(rows[0], map[string]any{"m": "2026-03-01", "v": 5.0}) {
		t.Fatalf("got %v %v", v.Issues, v.Spec["data"])
	}
}

func TestApplyTransformAlone(t *testing.T) {
	rows := []map[string]any{{"k": "a", "v": 1.0}, {"k": "b", "v": 5.0}, {"k": "a", "v": 2.0}}
	out, issues, ok := ApplyTransform(`[{"aggregate":{"groupBy":["k"],"fields":{"v":"sum"}}},{"top":{"n":1,"by":"v"}}]`, rows)
	if !ok || len(issues) != 0 || len(out) != 1 || out[0]["k"] != "b" || out[0]["v"] != 5.0 {
		t.Fatalf("got %v %v %v", out, issues, ok)
	}
	if _, issues, ok := ApplyTransform([]any{map[string]any{"sort": map[string]any{"field": "nope"}}}, rows); ok || len(issues) != 1 || issues[0].Code != "no_such_column" || issues[0].Path != "transform[0].sort.field" {
		t.Fatalf("got %v %v", issues, ok)
	}
	if got := TimeBucket(1767225600000, "week"); got != "2025-12-29" {
		t.Fatal(got)
	}
}

func TestDescribeCases(t *testing.T) {
	for _, x := range load(t).DescribeCases {
		got, err := DescribePlot(x.Spec)
		if x.Describe == nil {
			if err == nil {
				t.Fatalf("%s: expected an error", x.Name)
			}
			continue
		}
		if err != nil || got != *x.Describe {
			t.Fatalf("%s:\n got %q (%v)\nwant %q", x.Name, got, err, *x.Describe)
		}
	}
}

func TestGeographyCases(t *testing.T) {
	for _, x := range load(t).GeographyCases {
		opts := x.options()
		if x.Preset != "" {
			preset, ok := GeoPresets[x.Preset]
			if !ok {
				t.Fatalf("%s: no preset %q", x.Name, x.Preset)
			}
			opts = preset
		}
		issues, err := RegisterGeography(x.As, x.input(), opts)
		if ge, failed := err.(*GeographyError); failed {
			issues = ge.Issues
		} else if err != nil {
			t.Fatalf("%s: %v", x.Name, err)
		}
		want := append([]issueKey{}, x.Issues...)
		sort.Slice(want, func(i, j int) bool { return fmt.Sprint(want[i]) < fmt.Sprint(want[j]) })
		if (err == nil) != x.OK || !reflect.DeepEqual(append([]issueKey{}, keyed(issues)...), want) {
			t.Fatalf("%s: ok=%v issues\n got %v\nwant %v", x.Name, err == nil, keyed(issues), want)
		}
		geoMu.RLock()
		geo := geoRegistry[x.As]
		geoMu.RUnlock()
		if !x.OK {
			if geo != nil {
				t.Fatalf("%s: registered although it failed", x.Name)
			}
			continue
		}
		if !UnregisterGeography(x.As) {
			t.Fatalf("%s: not registered", x.Name)
		}
		if len(geo.regions) != len(x.Regions) {
			t.Fatalf("%s: regions %v want %v", x.Name, geo.regions, x.Regions)
		}
		for i, r := range x.Regions {
			if got := geo.regions[i]; got.key != r.Key || got.name != r.Name || got.disputed != r.Disputed {
				t.Fatalf("%s: region %d is %+v want %+v", x.Name, i, got, r)
			}
		}
		for _, m := range x.Matches {
			want, _ := m[1].(string)
			if got := geo.lookup[normalizeRegion(m[0])]; got != want {
				t.Fatalf("%s: %q matches %q want %q", x.Name, m[0], got, want)
			}
		}
	}
}

func TestGeographyRegistry(t *testing.T) {
	if _, err := RegisterGeography("not a name!", `{}`); err == nil {
		t.Fatal("expected an error")
	}
	fc := map[string]any{"type": "FeatureCollection", "features": []any{map[string]any{
		"type": "Feature", "id": "N", "properties": map[string]any{"name": "North"},
		"geometry": map[string]any{"type": "Polygon", "coordinates": []any{[]any{[]float64{0, 0}, []float64{1, 0}, []float64{1, 1}}}},
	}}}
	key := func(p map[string]any, id any) any { return fmt.Sprint(id, "-", p["name"]) }
	if warnings, err := RegisterGeography("conf-fn", fc, GeographyOptions{Key: key}); err != nil || len(warnings) != 0 {
		t.Fatal(warnings, err)
	}
	if v := ValidatePlot(`{"type":"choropleth","geo":"conf-fn","region":"r","value":"v","data":[{"r":"n-north","v":1}]}`); !v.OK {
		t.Fatal(v.Issues)
	}
	if !contains(Geographies(), "conf-fn") || !UnregisterGeography("conf-fn") || UnregisterGeography("conf-fn") {
		t.Fatal("registry out of step")
	}
	if v := ValidatePlot(`{"type":"choropleth","geo":"conf-fn","region":"r","value":"v","data":[{"r":"n-north","v":1}]}`); v.OK || v.Issues[0].Code != "unknown_geography" {
		t.Fatal(v.Issues)
	}
}

func TestRequireValidReportsEveryIssue(t *testing.T) {
	_, err := RequireValid(map[string]any{"type": "bar", "x": "nope", "y": "v", "stak": 1.0, "data": []any{map[string]any{"a": 1.0, "v": 1.0}}})
	se, ok := err.(*SpecError)
	if !ok || len(se.Issues) < 2 {
		t.Fatalf("got %v", err)
	}
}

func TestAcceptsJSONTextAndStructs(t *testing.T) {
	if v := ValidatePlot(`{"type":"pie","label":"a","value":"b","data":[{"a":"x","b":1}]}`); !v.OK {
		t.Fatal(v.Issues)
	}
	type row struct {
		A string `json:"a"`
		B int    `json:"b"`
	}
	v := ValidatePlot(map[string]any{"type": "pie", "label": "a", "value": "b", "data": []row{{"x", 1}, {"y", 2}}})
	if !v.OK {
		t.Fatal(v.Issues)
	}
	if v := ValidatePlot("{nope"); v.OK || v.Issues[0].Code != "invalid_json" {
		t.Fatal(v.Issues)
	}
}

func TestDensity(t *testing.T) {
	c := load(t)
	if len(c.Density) == 0 {
		t.Fatal("no density cases")
	}
	for i, k := range c.Density {
		name := fmt.Sprintf("density[%d]", i)
		d, ok := KDE(k.In.Values, k.In.Bandwidth, 0)
		if !ok {
			t.Fatalf("%s: no density", name)
		}
		nums(t, name+" silverman", []float64{Silverman(k.In.Values), d.Bandwidth}, []float64{k.Out.Silverman, k.Out.Bandwidth})
		nums(t, name+" grid", d.Grid, k.Out.Grid)
		nums(t, name+" density", d.Density, k.Out.Density)
		nums(t, name+" peaks", d.Peaks(), k.Out.Peaks)
	}
}

func TestLogScale(t *testing.T) {
	c := load(t)
	if len(c.LogTicks) == 0 || len(c.LogNiceDomain) == 0 {
		t.Fatal("no log cases")
	}
	for _, k := range c.LogTicks {
		nums(t, fmt.Sprint("logTicks ", k.In), LogTicks(k.In[0], k.In[1], k.In[2]), k.Out)
	}
	for _, k := range c.LogNiceDomain {
		lo, hi := NiceLogDomain(k.In[0], k.In[1])
		nums(t, fmt.Sprint("logNiceDomain ", k.In), []float64{lo, hi}, k.Out[:])
	}
}

func TestLoess(t *testing.T) {
	c := load(t)
	if len(c.Loess) == 0 {
		t.Fatal("no loess cases")
	}
	for i, k := range c.Loess {
		got := Loess(k.In.Xs, k.In.Ys, k.In.Bandwidth, k.In.Grid)
		if len(got) != len(k.Out) {
			t.Fatalf("loess[%d]: got %d points, want %d", i, len(got), len(k.Out))
		}
		for j := range got {
			nums(t, fmt.Sprintf("loess[%d][%d]", i, j), got[j][:], k.Out[j][:])
		}
	}
}

func TestTransformBinEdges(t *testing.T) {
	c := load(t)
	if len(c.BinStep) == 0 {
		t.Fatal("no binStep cases")
	}
	for i, k := range c.BinStep {
		nums(t, fmt.Sprintf("binStep[%d]", i), TransformBinEdges(k.In.Values, k.In.Maxbins, k.In.Step), k.Out)
	}
}

func TestWaffleCells(t *testing.T) {
	c := load(t)
	if len(c.WaffleCells) == 0 {
		t.Fatal("no waffleCells cases")
	}
	for i, k := range c.WaffleCells {
		if got := WaffleCells(k.In.Values, k.In.Cells); fmt.Sprint(got) != fmt.Sprint(k.Out) {
			t.Fatalf("waffleCells[%d]: got %v want %v", i, got, k.Out)
		}
	}
}

func TestJitterUnit(t *testing.T) {
	c := load(t)
	if len(c.JitterUnit) == 0 {
		t.Fatal("no jitterUnit cases")
	}
	for i, k := range c.JitterUnit {
		if got := JitterUnit(k.In.Index, k.In.Axis); math.Abs(got-k.Out) > 1e-9 {
			t.Fatalf("jitterUnit[%d] (%d, %s): got %v want %v", i, k.In.Index, k.In.Axis, got, k.Out)
		}
	}
}

func TestCloudLayout(t *testing.T) {
	c := load(t)
	if len(c.CloudLayout) == 0 {
		t.Fatal("no cloudLayout cases")
	}
	for i, k := range c.CloudLayout {
		type word struct {
			size int
			text string
		}
		widths := map[word]float64{}
		for j, w := range k.In.Words {
			widths[word{w.Size, w.Text}] = k.In.Widths[j]
		}
		got := CloudLayout(k.In.Words, k.In.Width, k.In.Height, func(text string, size int) float64 { return widths[word{size, text}] })
		if !reflect.DeepEqual(got, k.Out) {
			gb, _ := json.Marshal(got)
			wb, _ := json.Marshal(k.Out)
			t.Fatalf("cloudLayout[%d]: got %s want %s", i, gb, wb)
		}
	}
}
