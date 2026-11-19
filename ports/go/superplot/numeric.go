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
	step1 := pow10(int(math.Floor(math.Log10(step0))))
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
	return int(math.Max(0, -math.Floor(math.Log10(step)+1e-9)))
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
				fd = (2 * iqr) / math.Cbrt(float64(len(s)))
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
	dec := int(math.Max(0, -math.Floor(math.Log10(step)+1e-9))) + 1
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
