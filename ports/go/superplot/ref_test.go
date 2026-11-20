// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
package superplot

import (
	"encoding/json"
	"os"
	"testing"
)

// undefinedValue maps the conformance data's `{"undefined": true}` (JavaScript undefined) to nil.
func undefinedValue(v any) any {
	if m, ok := v.(map[string]any); ok && len(m) == 1 && m["undefined"] == true {
		return nil
	}
	return v
}

// asJSON is v as decoded JSON, for comparing with the conformance data.
func asJSON(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// The protocol's own card reference cases, vendored as conformance/card-ref.v1.json.
func TestCardRefShell(t *testing.T) {
	b, err := os.ReadFile("../../../conformance/card-ref.v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var c struct {
		Parse  []struct{ Value, Expect any } `json:"card_ref_parse"`
		Format []struct{ Value, Expect any } `json:"card_ref_format"`
	}
	if err := json.Unmarshal(b, &c); err != nil {
		t.Fatal(err)
	}
	if len(c.Parse) == 0 || len(c.Format) == 0 {
		t.Fatal("no card ref cases")
	}
	for _, x := range c.Parse {
		if got := asJSON(t, ParseCardRef(undefinedValue(x.Value))); !same(got, x.Expect) {
			t.Errorf("parse %v: got %v want %v", x.Value, got, x.Expect)
		}
	}
	for _, x := range c.Format {
		var got any
		if link, ok := FormatCardRef(undefinedValue(x.Value)); ok {
			got = link
		}
		if !same(got, x.Expect) {
			t.Errorf("format %v: got %v want %v", x.Value, got, x.Expect)
		}
	}
}

func TestRefCases(t *testing.T) {
	b, err := os.ReadFile("../../../conformance/plot.v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var c struct {
		Refs []struct {
			Name   string          `json:"name"`
			Spec   json.RawMessage `json:"spec"`
			Ref    string          `json:"ref"`
			Hidden []string        `json:"hidden"`
			Out    any             `json:"out"`
		} `json:"refCases"`
		Periods []struct {
			In  string    `json:"in"`
			Out []float64 `json:"out"`
		} `json:"datePeriods"`
	}
	if err := json.Unmarshal(b, &c); err != nil {
		t.Fatal(err)
	}
	if len(c.Refs) == 0 || len(c.Periods) == 0 {
		t.Fatal("no ref cases")
	}
	for _, x := range c.Refs {
		if got := asJSON(t, ResolveRef([]byte(x.Spec), x.Ref, x.Hidden)); !same(got, x.Out) {
			t.Errorf("%s: got %v want %v", x.Name, got, x.Out)
		}
	}
	for _, x := range c.Periods {
		lo, hi, ok := DatePeriod(x.In)
		if ok != (x.Out != nil) || (ok && (!near(lo, x.Out[0]) || !near(hi, x.Out[1]))) {
			t.Errorf("DatePeriod(%q) = %v %v %v, want %v", x.In, lo, hi, ok, x.Out)
		}
	}
	// A CardRef value works like its text.
	m := ResolveRef(map[string]any{"type": "bar", "x": "k", "y": "v", "data": []any{map[string]any{"k": "a", "v": 1.0}}}, CardRef{Target: "t", Params: map[string][]string{"x": {"a"}}}, nil)
	if !m.OK || len(m.Rows) != 1 {
		t.Fatalf("CardRef: %+v", m)
	}
}
