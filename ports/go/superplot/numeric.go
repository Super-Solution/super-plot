// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
package superplot

import (
	"math"
	"sort"
	"strconv"
	"strings"
)

var (
	e10 = math.Sqrt(50)
	e5  = math.Sqrt(10)
	e2  = math.Sqrt(2)
)

// TickStep is a "nice" step (1, 2 or 5 times a power of ten) giving about count intervals.
func TickStep(start, stop, count float64) float64 {
	step0 := math.Abs(stop-start) / math.Max(1, count)
	if !(step0 > 0) || !isFinite(step0) {
		return 1
	}
	step1 := pow10(int(math.Floor(jsLog10(step0))))
	err := step0 / step1
	switch {
	case err >= e10:
		step1 *= 10
	case err >= e5:
		step1 *= 5
	case err >= e2:
		step1 *= 2
	}
	return step1
}

func decimalsOf(step float64) int {
	return int(math.Max(0, -math.Floor(jsLog10(step)+1e-9)))
}

func parseFixed(x float64, digits int) float64 {
	f, _ := strconv.ParseFloat(toFixed(x, digits), 64)
	return f
}

// LinearTicks returns round-number tick values inside [a, b].
func LinearTicks(a, b, count float64) []float64 {
	if a == b {
		return []float64{a}
	}
	lo, hi := math.Min(a, b), math.Max(a, b)
	step := TickStep(lo, hi, count)
	dec := decimalsOf(step)
	first := int(math.Ceil(lo/step - 1e-9))
	last := int(math.Floor(hi/step + 1e-9))
	out := []float64{}
	for i := first; i <= last; i++ {
		out = append(out, parseFixed(float64(i)*step, dec))
	}
	return out
}

// NiceDomain expands [a, b] outwards to tick boundaries.
func NiceDomain(a, b, count float64) (float64, float64) {
	if a == b {
		if a == 0 {
			return 0, 1
		}
		pad := math.Abs(a) * 0.1
		return a - pad, b + pad
	}
	lo, hi := math.Min(a, b), math.Max(a, b)
	for i := 0; i < 2; i++ {
		step := TickStep(lo, hi, count)
		nlo := math.Floor(lo/step+1e-9) * step
		nhi := math.Ceil(hi/step-1e-9) * step
		if nlo == lo && nhi == hi {
			break
		}
		lo, hi = nlo, nhi
	}
	dec := decimalsOf(TickStep(lo, hi, count)) + 1
	return parseFixed(lo, dec), parseFixed(hi, dec)
}

func extent(values []float64) (float64, float64, bool) {
	lo, hi := math.Inf(1), math.Inf(-1)
	for _, v := range values {
		if v < lo {
			lo = v
		}
		if v > hi {
			hi = v
		}
	}
	return lo, hi, lo <= hi
}

// total is a left-to-right sum, as JavaScript's reduce does.
func total(values []float64) float64 {
	s := 0.0
	for _, v := range values {
		s += v
	}
	return s
}

func mean(values []float64) float64 {
	if len(values) == 0 {
		return math.NaN()
	}
	return total(values) / float64(len(values))
}

// Quantile of an ascending slice, linear interpolation (type 7: the R / NumPy default).
func Quantile(sorted []float64, p float64) float64 {
	n := len(sorted)
	switch n {
	case 0:
		return math.NaN()
	case 1:
		return sorted[0]
	}
	h := float64(n-1) * p
	lo := int(math.Floor(h))
	hi := lo + 1
	if hi > n-1 {
		hi = n - 1
	}
	return sorted[lo] + float64((h-float64(lo))*(sorted[hi]-sorted[lo]))
}

// correlation is Pearson's r; ok is false when undefined (fewer than 2 points or zero variance).
// float64(...) around each product stops the compiler fusing it into an FMA, which would change the last digit.
func correlation(xs, ys []float64) (float64, bool) {
	n := len(xs)
	if len(ys) < n {
		n = len(ys)
	}
	if n < 2 {
		return 0, false
	}
	mx, my := mean(xs[:n]), mean(ys[:n])
	var sxy, sxx, syy float64
	for i := 0; i < n; i++ {
		dx, dy := xs[i]-mx, ys[i]-my
		sxy += float64(dx * dy)
		sxx += float64(dx * dx)
		syy += float64(dy * dy)
	}
	if sxx == 0 || syy == 0 {
		return 0, false
	}
	return sxy / math.Sqrt(float64(sxx*syy)), true
}

func levenshtein(a, b string) int {
	if a == b {
		return 0
	}
	ra, rb := []rune(a), []rune(b)
	m, n := len(ra), len(rb)
	if m == 0 {
		return n
	}
	if n == 0 {
		return m
	}
	prev := make([]int, n+1)
	for i := range prev {
		prev[i] = i
	}
	for i := 1; i <= m; i++ {
		cur := make([]int, n+1)
		cur[0] = i
		for j := 1; j <= n; j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev = cur
	}
	return prev[n]
}

// closest is the nearest candidate by edit distance, for "did you mean". ok is false when none is near.
func closest(word string, candidates []string) (string, bool) {
	best, bestD := "", math.MaxInt
	w := strings.ToLower(word)
	for _, c := range candidates {
		if d := levenshtein(w, strings.ToLower(c)); d < bestD {
			bestD, best = d, c
		}
	}
	limit := max(2, ulen(word)/3)
	return best, bestD != math.MaxInt && bestD <= limit
}

// BoxStats are Tukey box statistics: whiskers reach the furthest value within 1.5 x IQR of the box.
type BoxStats struct {
	N                              int
	Min, Q1, Median, Q3, Max, Mean float64
	LowWhisker, HighWhisker        float64
	Outliers                       []float64
}

// ComputeBoxStats returns the box statistics of values; ok is false for an empty slice.
func ComputeBoxStats(values []float64) (BoxStats, bool) {
	if len(values) == 0 {
		return BoxStats{}, false
	}
	v := append([]float64(nil), values...)
	sort.Float64s(v)
	q1, q3 := Quantile(v, 0.25), Quantile(v, 0.75)
	iqr := q3 - q1
	lf, hf := q1-float64(1.5*iqr), q3+float64(1.5*iqr)
	var inside, outliers []float64
	for _, x := range v {
		if x >= lf && x <= hf {
			inside = append(inside, x)
		} else {
			outliers = append(outliers, x)
		}
	}
	return BoxStats{N: len(v), Min: v[0], Q1: q1, Median: Quantile(v, 0.5), Q3: q3, Max: v[len(v)-1], Mean: mean(v),
		LowWhisker: inside[0], HighWhisker: inside[len(inside)-1], Outliers: outliers}, true
}

// BinEdges returns bin edges that cover [min, max] with round numbers. bins <= 0 means "auto"; binWidth > 0 overrides bins.
func BinEdges(values []float64, bins int, binWidth float64) []float64 {
	lo, hi, ok := extent(values)
	if !ok {
		return []float64{0, 1}
	}
	if lo == hi {
		return []float64{lo - 0.5, hi + 0.5}
	}
	var step float64
	if binWidth > 0 {
		step = binWidth
	} else {
		var n float64
		if bins <= 0 {
			s := append([]float64(nil), values...)
			sort.Float64s(s)
			iqr := Quantile(s, 0.75) - Quantile(s, 0.25)
			fd := 0.0
			if iqr > 0 {
				fd = (2 * iqr) / jsCbrt(float64(len(s)))
			}
			if fd > 0 {
				n = math.Ceil((hi - lo) / fd)
			} else {
				n = math.Ceil(math.Log2(float64(len(s)))) + 1
			}
			n = math.Min(40, math.Max(5, n))
		} else {
			n = float64(bins)
		}
		step = TickStep(lo, hi, n)
	}
	dec := int(math.Max(0, -math.Floor(jsLog10(step)+1e-9))) + 1
	base := math.Floor(lo/step+1e-9) * step
	out := []float64{}
	for i := 0; base+float64(i)*step < hi+step*1e-9 && len(out) < 400; i++ {
		out = append(out, parseFixed(base+float64(float64(i)*step), dec))
	}
	if out[len(out)-1] <= hi {
		out = append(out, parseFixed(out[len(out)-1]+step, dec))
	}
	return out
}

// BinCounts counts values into [edge_i, edge_i+1); the last bin also includes its upper edge.
func BinCounts(values, edges []float64) []int {
	counts := make([]int, len(edges)-1)
	for _, v := range values {
		if v < edges[0] || v > edges[len(edges)-1] {
			continue
		}
		lo, hi := 0, len(edges)-1
		for hi-lo > 1 {
			mid := (lo + hi) >> 1
			if v >= edges[mid] {
				lo = mid
			} else {
				hi = mid
			}
		}
		counts[min(lo, len(counts)-1)]++
	}
	return counts
}

// binIndex is the index of the bin holding v ([edge_i, edge_i+1), the last bin closed), or -1 outside the edges.
func binIndex(v float64, edges []float64) int {
	if !(v >= edges[0]) || !(v <= edges[len(edges)-1]) {
		return -1
	}
	lo, hi := 0, len(edges)-1
	for hi-lo > 1 {
		mid := (lo + hi) >> 1
		if v >= edges[mid] {
			lo = mid
		} else {
			hi = mid
		}
	}
	return min(lo, len(edges)-2)
}

// nextNiceStep is the next round step after step: 1, 2, 5, 10, 20, 50, ... times a power of ten.
func nextNiceStep(step float64) float64 {
	p := pow10(int(math.Floor(jsLog10(step) + 1e-9)))
	m := step / p
	switch {
	case m < 1.5:
		return float64(2 * p)
	case m < 3.5:
		return float64(5 * p)
	}
	return float64(10 * p)
}

// TransformBinEdges returns the edges the `bin` transform step uses: step when it is above zero, otherwise the
// histogram's round step for maxbins, made coarser (1, 2, 5 times a power of ten) until there are at most maxbins bins.
func TransformBinEdges(values []float64, maxbins int, step float64) []float64 {
	if step > 0 {
		return BinEdges(values, maxbins, step)
	}
	edges := BinEdges(values, maxbins, 0)
	for guard := 0; len(edges)-1 > maxbins && guard < 60; guard++ {
		edges = BinEdges(values, maxbins, nextNiceStep(edges[1]-edges[0]))
	}
	return edges
}

// jsRound is Math.round: to the nearest integer, halves towards plus infinity.
func jsRound(x float64) float64 {
	f := math.Floor(x)
	if x-f >= 0.5 {
		return f + 1
	}
	return f
}

// r2 rounds to two decimals; 0 for a non-finite value.
func r2(v float64) float64 {
	if !isFinite(v) {
		return 0
	}
	return jsRound(float64(v*100)) / 100
}

// NiceLogDomain widens [lo, hi] (both above zero) to powers of ten; a single value gets one decade each side.
func NiceLogDomain(lo, hi float64) (float64, float64) {
	if !(lo > 0) || !(hi > 0) {
		return 1, 10
	}
	a, b := math.Min(lo, hi), math.Max(lo, hi)
	k0 := int(math.Floor(jsLog10(a) + 1e-12))
	k1 := int(math.Ceil(jsLog10(b) - 1e-12))
	if k0 == k1 {
		k0--
		k1++
	}
	return pow10(k0), pow10(k1)
}

// LogTicks returns ticks for a log axis on [a, b] (both above zero): powers of ten, with 2 and 5 times each when
// the range is short.
func LogTicks(a, b, count float64) []float64 {
	lo, hi := math.Min(a, b), math.Max(a, b)
	out := []float64{}
	if !(lo > 0) || !isFinite(hi) {
		return out
	}
	k0 := int(math.Ceil(jsLog10(lo) - 1e-9))
	k1 := int(math.Floor(jsLog10(hi) + 1e-9))
	decades := jsLog10(hi / lo)
	if decades <= math.Max(1, count/3) {
		for k := int(math.Floor(jsLog10(lo))); k <= int(math.Ceil(jsLog10(hi))); k++ {
			for _, m := range []string{"1", "2", "5"} {
				v, _ := strconv.ParseFloat(m+"e"+strconv.Itoa(k), 64)
				if v >= float64(lo*(1-1e-9)) && v <= float64(hi*(1+1e-9)) {
					out = append(out, v)
				}
			}
		}
	} else {
		stride := int(math.Max(1, math.Ceil(float64(k1-k0+1)/math.Max(1, count))))
		for k := k0; k <= k1; k++ {
			if (k-k0)%stride == 0 {
				out = append(out, pow10(k))
			}
		}
	}
	if len(out) < 2 {
		out = []float64{}
		for _, v := range LinearTicks(lo, hi, math.Max(2, count)) {
			if v > 0 {
				out = append(out, v)
			}
		}
	}
	return out
}

const (
	densityPoints    = 64
	maxDensityPoints = 512
)

func densityGrid(span, h float64) int {
	if !(h > 0) {
		return densityPoints
	}
	return int(math.Min(maxDensityPoints, math.Max(densityPoints, math.Ceil(float64(2*span)/h)+1)))
}

// Silverman is Silverman's rule of thumb for a Gaussian kernel: 0.9 * min(sd, IQR / 1.34) * n^(-1/5).
func Silverman(values []float64) float64 {
	n := len(values)
	if n < 2 {
		return 0
	}
	v := append([]float64(nil), values...)
	sort.Float64s(v)
	m := 0.0
	for _, x := range v {
		m += x
	}
	m /= float64(n)
	ss := 0.0
	for _, x := range v {
		ss += float64((x - m) * (x - m))
	}
	sd := math.Sqrt(ss / float64(n-1))
	iqr := (Quantile(v, 0.75) - Quantile(v, 0.25)) / 1.34
	a := math.Min(sd, iqr)
	if !(a > 0) {
		a = math.Max(sd, iqr)
	}
	return float64(float64(0.9*a) * jsPow(float64(n), -0.2))
}

// Density is a Gaussian kernel density estimate on an even grid from the smallest to the largest value.
type Density struct {
	Bandwidth float64
	Grid      []float64
	Density   []float64
}

// KDE estimates the density of values. bandwidth <= 0 means Silverman's rule; points <= 0 means the default grid
// (64 to 512 values, by the range over the bandwidth). When all values are equal the grid is that one value with
// density 1; ok is false for no values.
func KDE(values []float64, bandwidth float64, points int) (Density, bool) {
	n := len(values)
	if n == 0 {
		return Density{}, false
	}
	lo, hi := math.Inf(1), math.Inf(-1)
	for _, x := range values {
		if x < lo {
			lo = x
		}
		if x > hi {
			hi = x
		}
	}
	h := bandwidth
	if !(h > 0) {
		h = Silverman(values)
	}
	if hi == lo || !(h > 0) {
		if !(h > 0) {
			h = 0
		}
		return Density{Bandwidth: h, Grid: []float64{lo}, Density: []float64{1}}, true
	}
	k := points
	if k <= 0 {
		k = densityGrid(hi-lo, h)
	}
	k = max(2, k)
	norm := 1 / float64(float64(float64(n)*h)*math.Sqrt(2*math.Pi))
	d := Density{Bandwidth: h, Grid: make([]float64, 0, k), Density: make([]float64, 0, k)}
	for i := 0; i < k; i++ {
		t := lo + float64((hi-lo)*float64(i))/float64(k-1)
		s := 0.0
		for _, x := range values {
			u := (t - x) / h
			s += jsExp(float64(float64(-0.5*u) * u))
		}
		d.Grid = append(d.Grid, t)
		d.Density = append(d.Density, float64(s*norm))
	}
	return d, true
}

// Peaks are the grid values where the density has a local maximum of at least a quarter of its highest value.
func (d Density) Peaks() []float64 {
	if len(d.Grid) == 1 {
		return []float64{d.Grid[0]}
	}
	y := d.Density
	top, at := math.Inf(-1), 0
	for i, v := range y {
		if v > top {
			top, at = v, i
		}
	}
	out := []float64{}
	for i := range y {
		left, right := math.Inf(-1), math.Inf(-1)
		if i > 0 {
			left = y[i-1]
		}
		if i < len(y)-1 {
			right = y[i+1]
		}
		if y[i] > left && y[i] >= right && y[i] >= float64(top*0.25) {
			out = append(out, d.Grid[i])
		}
	}
	if len(out) == 0 {
		return []float64{d.Grid[at]}
	}
	return out
}

const loessGrid = 50

// Loess is a locally weighted linear regression (degree 1, tricube weights, no robustness iterations) evaluated
// on an even grid of grid x values. It returns [x, fitted y] pairs, none for fewer than 3 points.
func Loess(xs, ys []float64, bandwidth float64, grid int) [][2]float64 {
	type pt struct{ x, y float64 }
	pts := []pt{}
	for i := 0; i < len(xs) && i < len(ys); i++ {
		if isFinite(xs[i]) && isFinite(ys[i]) {
			pts = append(pts, pt{xs[i], ys[i]})
		}
	}
	out := [][2]float64{}
	if len(pts) < 3 {
		return out
	}
	sort.SliceStable(pts, func(i, j int) bool { return pts[i].x < pts[j].x })
	n := len(pts)
	q := min(n, max(2, int(math.Floor(float64(bandwidth*float64(n))))))
	lo, hi := pts[0].x, pts[n-1].x
	count := 1
	if lo != hi {
		count = max(2, grid)
	}
	l := 0
	w := make([]float64, 0, q)
	for k := 0; k < count; k++ {
		g := hi
		if k != count-1 {
			g = lo + float64((hi-lo)*float64(k))/float64(count-1)
		}
		for l+q < n && g-pts[l].x > pts[l+q].x-g {
			l++
		}
		r := l + q - 1
		d := math.Max(g-pts[l].x, pts[r].x-g)
		var sw, swx, swy float64
		w = w[:0]
		for i := l; i <= r; i++ {
			wi := 1.0
			if d > 0 {
				u := math.Abs(pts[i].x-g) / d
				if u >= 1 {
					wi = 0
				} else {
					wi = jsPow(1-float64(float64(u*u)*u), 3)
				}
			}
			w = append(w, wi)
			sw += wi
			swx += float64(wi * pts[i].x)
			swy += float64(wi * pts[i].y)
		}
		if !(sw > 0) {
			s := 0.0
			for i := l; i <= r; i++ {
				s += pts[i].y
			}
			out = append(out, [2]float64{g, s / float64(r-l+1)})
			continue
		}
		mx, my := swx/sw, swy/sw
		var sxx, sxy float64
		for i := l; i <= r; i++ {
			dx := pts[i].x - mx
			sxx += float64(float64(w[i-l]*dx) * dx)
			sxy += float64(float64(w[i-l]*dx) * (pts[i].y - my))
		}
		spread := pts[r].x - pts[l].x
		if spread == 0 || sxx <= float64(float64(float64(1e-12*sw)*spread)*spread) {
			out = append(out, [2]float64{g, my})
		} else {
			out = append(out, [2]float64{g, my + float64((sxy/sxx)*(g-mx))})
		}
	}
	return out
}

// JitterMax is the most a point may be nudged, in pixels (`jitter` is at most this).
const JitterMax = 20

// JitterUnit is the offset scatter `jitter` is built on: for the row at index in the data (0-based, counted before any
// series is hidden) and an axis ("x" or "y"), a number in [-1, 1). The murmur3 finaliser on 32-bit integers:
// h = index*0x9E3779B1 + salt (modulo 2^32; salt 0x243F6A88 for x, 0x13198A2E for y), h ^= h>>16, h *= 0x85EBCA6B,
// h ^= h>>13, h *= 0xC2B2AE35, h ^= h>>16, then h/2^32*2 - 1. Unsigned shifts; every step is exact in float64.
func JitterUnit(index int, axis string) float64 {
	salt := uint32(0x13198A2E)
	if axis == "x" {
		salt = 0x243F6A88
	}
	h := uint32(index)*0x9E3779B1 + salt
	h ^= h >> 16
	h *= 0x85EBCA6B
	h ^= h >> 13
	h *= 0xC2B2AE35
	h ^= h >> 16
	return float64(h)/4294967296*2 - 1
}

// WaffleCells shares cells among the positive values by largest remainder; ties go to the earlier value.
func WaffleCells(values []float64, cells int) []int {
	tot := 0.0
	for _, v := range values {
		if v > 0 {
			tot += v
		}
	}
	out := make([]int, len(values))
	if !(tot > 0) {
		return out
	}
	exact := make([]float64, len(values))
	rest := make([]float64, len(values))
	order := make([]int, len(values))
	left := cells
	for i, v := range values {
		if v > 0 {
			exact[i] = float64((v / tot) * float64(cells))
		}
		f := math.Floor(exact[i])
		out[i] = int(f)
		rest[i] = exact[i] - f
		order[i] = i
		left -= out[i]
	}
	sort.SliceStable(order, func(a, b int) bool { return rest[order[a]] > rest[order[b]] })
	for _, i := range order {
		if left <= 0 {
			break
		}
		out[i]++
		left--
	}
	return out
}

// waffleGrid is the columns and rows of a waffle: 10 wide up to 100 cells, then 10 tall.
func waffleGrid(cells float64) (float64, float64) {
	cols := math.Max(10, cells/10)
	return cols, cells / cols
}
