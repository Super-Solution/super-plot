// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
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
		Out       [][]any             `json:"out"`
		Ticks     [][]any             `json:"ticks"`
		Bins      [][]any             `json:"bins"`
		Buckets   [][]any             `json:"buckets"`
		Logs      [][]any             `json:"logs"`
		Densities [][]any             `json:"densities"`
		Fits      [][]any             `json:"fits"`
		BinSteps  [][]any             `json:"binSteps"`
		Waffles   [][]any             `json:"waffles"`
		Durations [][]any             `json:"durations"`
		Exacts    [][]any             `json:"exacts"`
		Clouds    [][]json.RawMessage `json:"clouds"`
		Specs     []struct {
			Spec       json.RawMessage `json:"spec"` // as written: a decoded map forgets the order of a Topology's objects
			OK         bool            `json:"ok"`
			Issues     [][]string      `json:"issues"`
			Normalized map[string]any  `json:"normalized"`
			Describe   *string         `json:"describe"`
			Rows       []any           `json:"rows"` // what the chart reads after transform; absent without one
		} `json:"specs"`
		Refs [][]json.RawMessage `json:"refs"` // [spec index, ref, hidden or null, what resolveRef answered]
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
	for _, c := range d.Buckets {
		if got := sp.TimeBucket(c[0].(float64), c[1].(string)); got != c[2].(string) {
			report("BUCKET", c[0], c[1], got, c[2])
		}
	}
	// Round 5 statistics. Equal means equal: the ports compute these with the reference's own elementary functions.
	for _, c := range d.Logs {
		a, bb, n := c[0].(float64), c[1].(float64), c[2].(float64)
		lo, hi := sp.NiceLogDomain(a, bb)
		if wd := floats(c[4]); !reflect.DeepEqual(sp.LogTicks(a, bb, n), floats(c[3])) || lo != wd[0] || hi != wd[1] {
			report("LOG", a, bb, n, sp.LogTicks(a, bb, n), c[3], lo, hi, wd)
		}
	}
	for _, c := range d.Densities {
		vs := floats(c[0])
		bw, _ := c[1].(float64)
		k, _ := sp.KDE(vs, bw, 0)
		if sp.Silverman(vs) != c[2].(float64) || k.Bandwidth != c[3].(float64) || !reflect.DeepEqual(k.Grid, floats(c[4])) || !reflect.DeepEqual(k.Density, floats(c[5])) || !reflect.DeepEqual(k.Peaks(), floats(c[6])) {
			report("DENSITY", len(vs), bw, sp.Silverman(vs), c[2], k.Peaks(), c[6])
		}
	}
	for _, c := range d.Fits {
		got := sp.Loess(floats(c[0]), floats(c[1]), c[2].(float64), int(c[3].(float64)))
		want := c[4].([]any)
		same := len(got) == len(want)
		for i := 0; same && i < len(got); i++ {
			w := floats(want[i])
			same = got[i][0] == w[0] && got[i][1] == w[1]
		}
		if !same {
			report("LOESS", len(floats(c[0])), c[2], c[3])
		}
	}
	for _, c := range d.BinSteps {
		step, _ := c[2].(float64)
		if got := sp.TransformBinEdges(floats(c[0]), int(c[1].(float64)), step); !reflect.DeepEqual(got, floats(c[3])) {
			report("BINSTEP", c[1], c[2], got, c[3])
		}
	}
	for _, c := range d.Waffles {
		got := sp.WaffleCells(floats(c[0]), int(c[1].(float64)))
		for i, w := range floats(c[2]) {
			if float64(got[i]) != w {
				report("WAFFLE", c[0], c[1], got, c[2])
				break
			}
		}
	}
	for _, c := range d.Durations {
		if got := sp.FormatDuration(c[0].(float64)); got != c[1].(string) {
			report("DURATION", c[0], got, c[1])
		}
	}
	// Round 6: the 3D charts' exact number format, and word cloud layouts (whole pixels, so equal means equal).
	for _, c := range d.Exacts {
		if got := sp.FormatExact(c[0].(float64)); got != c[1].(string) {
			report("EXACT", c[0], got, c[1])
		}
	}
	for _, c := range d.Clouds {
		var words []sp.CloudWord
		var widths []float64
		var width, height float64
		var want []*sp.CloudBox
		for j, into := range []any{&words, &widths, &width, &height, &want} {
			if err := json.Unmarshal(c[j], into); err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(2)
			}
		}
		byText := map[string]float64{}
		for j, w := range words {
			byText[w.Text] = widths[j]
		}
		got := sp.CloudLayout(words, width, height, func(text string, _ int) float64 { return byText[text] })
		if !reflect.DeepEqual(got, want) {
			gb, _ := json.Marshal(got)
			report("CLOUD", len(words), width, height, string(gb), string(c[4]))
		}
	}
	for i, c := range d.Specs {
		v := sp.ValidatePlot([]byte(c.Spec))
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
			var rows []any
			if c.Rows != nil {
				rb, _ := json.Marshal(v.Spec["data"])
				_ = json.Unmarshal(rb, &rows)
			}
			if !reflect.DeepEqual(back, c.Normalized) {
				report("SPEC", i, "normalized")
			} else if !reflect.DeepEqual(rows, c.Rows) {
				report("SPEC", i, "rows", rows, c.Rows)
			} else if text, err := sp.DescribePlot([]byte(c.Spec)); err != nil || text != *c.Describe {
				report("SPEC", i, "describe", text, *c.Describe)
			}
		}
	}
	for _, c := range d.Refs {
		var i int
		var ref string
		var hidden []string
		var want any
		for j, into := range []any{&i, &ref, &hidden, &want} {
			if err := json.Unmarshal(c[j], into); err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(2)
			}
		}
		gb, _ := json.Marshal(sp.ResolveRef([]byte(d.Specs[i].Spec), ref, hidden))
		var got any
		_ = json.Unmarshal(gb, &got)
		if !reflect.DeepEqual(got, want) {
			report("REF", i, ref, hidden, string(gb), string(c[3]))
		}
	}
	fmt.Printf("go: %d numeric cases, %d specs, %d refs, %d mismatches\n", len(d.Out)+len(d.Ticks)+len(d.Bins)+len(d.Buckets)+len(d.Logs)+len(d.Densities)+len(d.Fits)+len(d.BinSteps)+len(d.Waffles)+len(d.Durations)+len(d.Exacts)+len(d.Clouds), len(d.Specs), len(d.Refs), bad)
	if bad > 0 {
		os.Exit(1)
	}
}
