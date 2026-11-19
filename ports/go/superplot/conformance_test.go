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

type issueKey struct{ Severity, Code, Path string }

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
	DescribeCases []struct {
		Name       string   `json:"name"`
		Spec       any      `json:"spec"`
		Describe   *string  `json:"describe"`
		IssueCodes []string `json:"issueCodes"`
	} `json:"describeCases"`
}

type validationCase struct {
	Name   string `json:"name"`
	Spec   any    `json:"spec"`
	OK     bool   `json:"ok"`
	Issues []struct {
		Severity string `json:"severity"`
		Code     string `json:"code"`
		Path     string `json:"path"`
	} `json:"issues"`
	Normalized map[string]any `json:"normalized"`
}

func load(t *testing.T) conformance {
	t.Helper()
	b, err := os.ReadFile("../../../conformance/plot.v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var c conformance
	if err := json.Unmarshal(b, &c); err != nil {
		t.Fatal(err)
	}
	return c
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
		v := ValidatePlot(x.Spec)
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
