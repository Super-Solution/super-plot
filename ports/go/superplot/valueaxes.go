// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
package superplot

import (
	"fmt"
	"math"
	"strings"
)

// Two value axes (yRight) and a broken value axis (yBreak): their checks and the sentences they add to a
// description. Mirrors packages/core/src/charts/valueaxes.ts.

var rightOnly = []string{"yRightLabel", "rightDomain", "formatRight", "rightReverse"}

// rightCols are the columns of yRight, as a list.
func rightCols(s spec) []string {
	if !has(s, "yRight") {
		return nil
	}
	return columnList(s["yRight"])
}

// rightFormat is formatRight, or format when it is not given.
func rightFormat(s spec) string {
	if has(s, "formatRight") {
		return str(s, "formatRight")
	}
	return str(s, "format")
}

// dualCheck checks yRight: refused says why a right axis cannot be drawn on this spec (an error), ignored why
// it is left out (a warning). left are the columns on the left axis.
func dualCheck(s spec, issues *[]Issue, left []string, refused, ignored string) {
	right := rightCols(s)
	if len(right) == 0 {
		for _, k := range rightOnly {
			if has(s, k) {
				issue(issues, "warning", "right_axis_unused", k, k+" is ignored: there is no right axis without `yRight`.", "Add yRight with the column(s) for the right axis, or drop this field.")
			}
		}
		return
	}
	if refused != "" {
		issue(issues, "error", "dual_axis_refused", "yRight", "A right axis is refused here: "+refused, "Index the series to a common base (an `index` transform step) and use one axis, or draw two charts with `sync`.")
		return
	}
	if ignored != "" {
		issue(issues, "warning", "dual_axis_ignored", "yRight", "yRight is ignored "+ignored, "Use vertical bars (or a line chart) for a right axis.")
		return
	}
	_, isList := s["yRight"].([]any)
	bad := false
	quoted := make([]string, len(right))
	for i, c := range right {
		quoted[i] = `"` + clip(c, 40) + `"`
		if contains(left, c) {
			bad = true
			path := "yRight"
			if isList {
				path = fmt.Sprintf("yRight[%d]", i)
			}
			issue(issues, "error", "dual_axis_overlap", path, fmt.Sprintf("Column %q is on both axes.", c), "Give each column one axis: remove it from y (or line), or from yRight.")
		}
	}
	if bad {
		return
	}
	issue(issues, "info", "dual_axis", "yRight",
		fmt.Sprintf("%s %s drawn against a second value axis on the right. Two independent scales on one plot can suggest a relationship (where lines cross, how far apart they are, whether they move together) that is only the choice of the two ranges.", fmtList(quoted, 5), plural(len(right), "is", "are")),
		"To compare growth, index every series to a common base (transform step {\"index\":{\"field\":...,\"groupBy\":[...]}}) and use one axis; to compare levels, draw two charts with `sync`. Keep the right axis only when the two measures are related and the reader needs both on one time line.")
}

// breakOf reads yBreak: given is false without the field, whole is false when an end is null.
func breakOf(s spec) (from, to float64, given, whole bool) {
	b, ok := s["yBreak"].([]any)
	if !ok || len(b) != 2 {
		return 0, 0, false, false
	}
	from, okFrom := b[0].(float64)
	to, okTo := b[1].(float64)
	return from, to, true, okFrom && okTo
}

// breakPlan sorts the values on a broken axis: those inside the cut, and whether any lies beyond it.
func breakPlan(values []float64, from, to float64, bars bool) (inside []float64, beyond bool) {
	above, below := false, false
	for _, v := range values {
		if v > from && v < to {
			inside = append(inside, v)
		}
		above = above || v >= to
		below = below || v <= from
	}
	if !bars {
		return inside, above && below
	}
	// Bars start at zero, outside the cut: the far side is the one away from zero.
	if from > 0 {
		return inside, above
	}
	return inside, below
}

func say(v float64) string { return numberString(jsRound(v*1e6) / 1e6) }

// breakCheck checks yBreak. values are the numbers drawn on the value axis. A break with no value beyond it is
// removed from the normalised spec, with a break_outside warning. Mirrors breakCheck.
func breakCheck(s spec, issues *[]Issue, values []float64, bars bool, refused string) bool {
	from, to, given, whole := breakOf(s)
	if !given {
		return false
	}
	if !whole {
		issue(issues, "error", "bad_value", "yBreak", "yBreak needs two numbers, [from, to]: the span to cut out of the axis.", "E.g. [50, 900] to cut out everything between 50 and 900.")
		return false
	}
	if refused != "" {
		issue(issues, "error", "break_refused", "yBreak", "A broken axis is refused here: "+refused, "Use facets or (on a line) a log scale to show values of very different size.")
		return false
	}
	span := fmt.Sprintf("[%s, %s]", say(from), say(to))
	if bars && from <= 0 && to >= 0 {
		issue(issues, "error", "break_misleading", "yBreak", "yBreak "+span+" cuts out zero, where every bar starts: the bars that do not cross the break would lose their baseline and their lengths would mean nothing.",
			"Move the break to a span that every bar either crosses or stays below (both ends above zero, or both below), or drop it and use facets.")
		return false
	}
	inside, beyond := breakPlan(values, from, to, bars)
	if !beyond {
		sides := " on both sides"
		if bars {
			sides = ""
		}
		issue(issues, "warning", "break_outside", "yBreak", "No value lies beyond yBreak "+span+sides+", so there is nothing to bring closer: the break is not drawn.", "Set the break between the small and the large values, or drop it.")
		// The normalised spec says what is drawn.
		delete(s, "yBreak")
		return false
	}
	if n := len(inside); n > 0 {
		shown := make([]string, 0, 5)
		for _, v := range inside[:min(5, n)] {
			shown = append(shown, say(v))
		}
		more := ""
		if n > 5 {
			more = ", ..."
		}
		issue(issues, "warning", "break_hides_values", "yBreak",
			fmt.Sprintf("%d %s inside the cut-out span (%s%s); %s drawn at the edge of the break, marked with a dashed outline, and tooltips say so.", n, plural(n, "value lies", "values lie"), strings.Join(shown, ", "), more, plural(n, "it is", "they are")),
			"A break should remove a span no value falls in. Narrow it so no value lies inside, or drop it.")
	}
	how := "Changes across the cut look smaller than they are"
	if bars {
		how = "Bars that cross the cut are drawn shorter than their value, so large and small bars look closer than they are"
	}
	issue(issues, "info", "axis_break", "yBreak",
		fmt.Sprintf("The value axis is cut from %s to %s: a span of %s is not drawn. %s; a zigzag gap marks the cut, and tooltips and the description give the real values.", say(from), say(to), say(to-from), how),
		"To show values of very different size without hiding part of the scale, use facets, or a log scale on a line chart.")
	return true
}

// rangeText is the lowest and highest of some numbers, as text in a format. Mirrors rangeText.
func rangeText(values []float64, format string) string {
	if len(values) == 0 {
		return "no values"
	}
	f := ValueFormatter(format)
	lo, hi := math.Inf(1), math.Inf(-1)
	for _, v := range values {
		if v < lo {
			lo = v
		}
		if v > hi {
			hi = v
		}
	}
	if lo == hi {
		return f(lo)
	}
	return f(lo) + " to " + f(hi)
}

// dualNote is the description's sentence on two value axes. Mirrors dualNote.
func dualNote(s spec, leftKeys []string, leftValues []float64, rightKeys []string, rightValues []float64) string {
	axis := func(side, label string) string {
		if label != "" {
			return fmt.Sprintf("the %s axis (%s)", side, clip(label, 60))
		}
		return "the " + side + " axis"
	}
	return fmt.Sprintf(" Two value axes with independent scales: %s shows %s (%s); %s shows %s (%s). Where the lines meet or how steep they look depends on the two chosen ranges, not on the data.",
		axis("left", str(s, "yLabel")), fmtList(clipAll(leftKeys, 40), 5), rangeText(leftValues, str(s, "format")),
		axis("right", str(s, "yRightLabel")), fmtList(clipAll(rightKeys, 40), 5), rangeText(rightValues, rightFormat(s)))
}

// breakNote is the description's sentence on a broken axis. Mirrors breakNote.
func breakNote(s spec, values []float64, bars bool) string {
	from, to, _, whole := breakOf(s)
	if !whole {
		return ""
	}
	f := formatter(s)
	inside, _ := breakPlan(values, from, to, bars)
	how := "changes across it look smaller than they are"
	if bars {
		how = "bars that cross it are drawn shorter than their value"
	}
	more := ""
	if n := len(inside); n > 0 {
		more = fmt.Sprintf(" %d %s inside the cut and %s drawn at its edge.", n, plural(n, "value lies", "values lie"), plural(n, "is", "are"))
	}
	return fmt.Sprintf(" The value axis is broken: the span from %s to %s is cut out, so %s; the values given here are the real ones.%s", f(from), f(to), how, more)
}

// rightLineCols are a bar chart's lines on a second value axis: vertical bars that are not 100% stacked only.
func rightLineCols(s spec) []string {
	if str(s, "orientation") == "horizontal" || str(s, "stack") == "normalize" {
		return nil
	}
	return rightCols(s)
}

// colSums is, per category, the sum of a column (duplicates summed, like bars). Mirrors colSums.
func colSums(s spec, col string) *omap[float64] {
	mm := newOmap[float64]()
	x := str(s, "x")
	for _, r := range rowsOf(s) {
		v, ok := toNumber(r[col])
		if !ok {
			continue
		}
		cat := keyString(r[x])
		cur, _ := mm.get(cat)
		mm.set(cat, cur+v)
	}
	return mm
}

// barAxisValues are the numbers drawn on a bar chart's left value axis: bars, lines and whisker ends.
func barAxisValues(s spec) []float64 {
	mod := newBarModel(s, columnList(s["y"]))
	var out []float64
	for _, r := range mod.m.values() {
		for _, k := range mod.keys {
			if v, ok := r.get(k); ok {
				out = append(out, v)
			}
		}
	}
	for _, k := range lineCols(s) {
		if !contains(mod.keys, k) {
			out = append(out, colSums(s, k).values()...)
		}
	}
	if lo, hi := str(s, "yLower"), str(s, "yUpper"); lo != "" && hi != "" && !stacked(s) {
		for _, r := range rowsOf(s) {
			for _, col := range []string{lo, hi} {
				if n, ok := toNumber(r[col]); ok {
					out = append(out, n)
				}
			}
		}
	}
	return out
}

// lineValues are the numbers a line chart draws on its value axis: the y columns and the interval ends.
func lineValues(s spec) []float64 {
	cols := append([]string(nil), columnList(s["y"])...)
	if lo, hi := str(s, "yLower"), str(s, "yUpper"); lo != "" && hi != "" {
		cols = append(cols, lo, hi)
	}
	var out []float64
	for _, r := range rowsOf(s) {
		for _, col := range cols {
			if n, ok := toNumber(r[col]); ok {
				out = append(out, n)
			}
		}
	}
	return out
}
