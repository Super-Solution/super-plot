// Command fuzzcheck compares the Go port with the reference on generated cases (see ports/fuzz/generate.mjs).
//
//	go run ./cmd/fuzzcheck cases.json
package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"reflect"
	"sort"

	sp "github.com/super-solution/super-plot/ports/go/superplot"
)

func near(a, b float64) bool { return a == b || math.Abs(a-b) <= 1e-12*math.Max(1, math.Abs(b)) }

func floats(v any) []float64 {
	l := v.([]any)
	o := make([]float64, len(l))
	for i, x := range l {
		o[i] = x.(float64)
	}
	return o
}

func main() {
	var d struct {
		Out   [][]any `json:"out"`
		Ticks [][]any `json:"ticks"`
		Bins  [][]any `json:"bins"`
		Specs []struct {
			Spec       map[string]any `json:"spec"`
			OK         bool           `json:"ok"`
			Issues     [][]string     `json:"issues"`
			Normalized map[string]any `json:"normalized"`
			Describe   *string        `json:"describe"`
		} `json:"specs"`
	}
	b, err := os.ReadFile(os.Args[1])
	if err == nil {
		err = json.Unmarshal(b, &d)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	bad := 0
	report := func(a ...any) {
		if bad++; bad <= 10 {
			fmt.Println(a...)
		}
	}
	for _, c := range d.Out {
		if got := sp.FormatValue(c[1].(float64), c[0].(string)); got != c[2].(string) {
			report("FORMAT", c[0], c[1], got, c[2])
		}
	}
	for _, c := range d.Ticks {
		a, bb, n := c[0].(float64), c[1].(float64), c[2].(float64)
		lo, hi := sp.NiceDomain(a, bb, n)
		wd := floats(c[4])
		if !reflect.DeepEqual(sp.LinearTicks(a, bb, n), floats(c[3])) || lo != wd[0] || hi != wd[1] {
			report("TICKS", a, bb, n)
		}
	}
	for _, c := range d.Bins {
		vs := floats(c[0])
		bins := 0
		if f, ok := c[1].(float64); ok {
			bins = int(f)
		}
		edges := sp.BinEdges(vs, bins, 0)
		if !reflect.DeepEqual(edges, floats(c[2])) {
			report("BINS", len(vs), bins)
			continue
		}
		want := c[3].([]any)
		for i, n := range sp.BinCounts(vs, edges) {
			if float64(n) != want[i].(float64) {
				report("COUNTS", i)
			}
		}
		st, _ := sp.ComputeBoxStats(vs)
		bx := c[4].(map[string]any)
		if !near(st.Q1, bx["q1"].(float64)) || !near(st.Median, bx["median"].(float64)) || !near(st.Mean, bx["mean"].(float64)) ||
			!near(st.HighWhisker, bx["highWhisker"].(float64)) || len(st.Outliers) != len(bx["outliers"].([]any)) {
			report("BOX", st, bx)
		}
	}
	for i, c := range d.Specs {
		v := sp.ValidatePlot(c.Spec)
		var got, want []string
		for _, x := range v.Issues {
			got = append(got, x.Severity+"|"+x.Code+"|"+x.Path)
		}
		for _, x := range c.Issues {
			want = append(want, x[0]+"|"+x[1]+"|"+x[2])
		}
		sort.Strings(got)
		sort.Strings(want)
		switch {
		case v.OK != c.OK:
			report("SPEC", i, "ok")
		case len(got) != len(want) || (len(got) > 0 && !reflect.DeepEqual(got, want)):
			report("SPEC", i, "issues", got, want)
		case v.OK:
			n := map[string]any{}
			for k, x := range v.Spec {
				if k != "data" {
					n[k] = x
				}
			}
			jb, _ := json.Marshal(n)
			var back map[string]any
			_ = json.Unmarshal(jb, &back)
			if !reflect.DeepEqual(back, c.Normalized) {
				report("SPEC", i, "normalized")
			} else if text, err := sp.DescribePlot(c.Spec); err != nil || text != *c.Describe {
				report("SPEC", i, "describe", text, *c.Describe)
			}
		}
	}
	fmt.Printf("go: %d numeric cases, %d specs, %d mismatches\n", len(d.Out)+len(d.Ticks)+len(d.Bins), len(d.Specs), bad)
	if bad > 0 {
		os.Exit(1)
	}
}
