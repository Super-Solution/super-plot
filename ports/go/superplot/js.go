package superplot

import (
	"encoding/json"
	"math"
	"math/big"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// JavaScript semantics the reference implementation relies on. Super Plot's reference is TypeScript and the
// conformance data was produced by it, so a port is only interchangeable when it reproduces the same edge cases:
// number to string, string to number, rounding, UTF-16 string length. They live here and nowhere else.

var (
	decRe   = regexp.MustCompile(`^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$`)
	radixRe = regexp.MustCompile(`^0[xX][0-9a-fA-F]+$|^0[bB][01]+$|^0[oO][0-7]+$`)
)

// jsSpace is what JavaScript's String.prototype.trim removes (Unicode white space and the BOM).
func jsTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		switch r {
		case '\t', '\n', '\v', '\f', '\r', ' ', 0x00a0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
			return true
		}
		return r >= 0x2000 && r <= 0x200a
	})
}

func isFinite(f float64) bool { return !math.IsNaN(f) && !math.IsInf(f, 0) }

// toNumber is a finite number from a number or a plain numeric string; ok is false for anything else
// (empty strings and booleans included).
func toNumber(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, isFinite(x)
	case string:
		t := jsTrim(x)
		if t == "" {
			return 0, false
		}
		if radixRe.MatchString(t) {
			base := map[byte]int{'x': 16, 'b': 2, 'o': 8}[t[1]|0x20]
			n, ok := new(big.Int).SetString(t[2:], base)
			if !ok {
				return 0, false
			}
			f, _ := new(big.Float).SetInt(n).Float64()
			return f, isFinite(f)
		}
		if decRe.MatchString(t) {
			f, err := strconv.ParseFloat(t, 64)
			if err != nil && !math.IsInf(f, 0) {
				return 0, false
			}
			return f, isFinite(f)
		}
	}
	return 0, false
}

// numberString is String(number): shortest round-trip digits, no trailing ".0", exponent form outside 1e-6 .. 1e21.
func numberString(v float64) string {
	switch {
	case math.IsNaN(v):
		return "NaN"
	case math.IsInf(v, 1):
		return "Infinity"
	case math.IsInf(v, -1):
		return "-Infinity"
	case v == 0:
		return "0"
	}
	sign := ""
	if v < 0 {
		sign, v = "-", -v
	}
	d := shortest(v)
	digits, n := string(d.digits), d.pt
	k := len(digits)
	switch {
	case k <= n && n <= 21:
		return sign + digits + strings.Repeat("0", n-k)
	case 0 < n && n <= 21:
		return sign + digits[:n] + "." + digits[n:]
	case -6 < n && n <= 0:
		return sign + "0." + strings.Repeat("0", -n) + digits
	}
	e := n - 1
	mant := digits[:1]
	if k > 1 {
		mant += "." + digits[1:]
	}
	es := "+"
	if e < 0 {
		es, e = "-", -e
	}
	return sign + mant + "e" + es + strconv.Itoa(e)
}

// jsString is String(v) for a JSON value.
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case bool:
		if x {
			return "true"
		}
		return "false"
	case float64:
		return numberString(x)
	case string:
		return x
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			if e != nil {
				parts[i] = jsString(e)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

// keyString is the category key of an x value: "" for null.
func keyString(v any) string {
	if v == nil {
		return ""
	}
	return jsString(v)
}

// orEmpty is String(v ?? ”).
func orEmpty(v any) string { return keyString(v) }

// ulen is JavaScript's .length: UTF-16 code units.
func ulen(s string) int {
	n := 0
	for _, r := range s {
		if r > 0xffff {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// uslice is s.slice(0, end) in UTF-16 units; a pair that would be cut in half is dropped.
func uslice(s string, end int) string {
	if ulen(s) <= end {
		return s
	}
	var b strings.Builder
	used := 0
	for _, r := range s {
		w := 1
		if r > 0xffff {
			w = 2
		}
		if used+w > end {
			break
		}
		b.WriteRune(r)
		used += w
	}
	return b.String()
}

// clip caps a spec-supplied string at limit UTF-16 units, ending in an ellipsis when it was cut.
func clip(s string, limit int) string {
	if ulen(s) > limit {
		return uslice(s, limit-1) + "…"
	}
	return s
}

// toFixed is Number.prototype.toFixed: the exact binary value, rounded half up.
func toFixed(x float64, digits int) string {
	if !isFinite(x) {
		return numberString(x)
	}
	neg := x < 0
	r := new(big.Rat).SetFloat64(math.Abs(x))
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(digits)), nil)
	num := new(big.Int).Mul(r.Num(), scale)
	num.Mul(num, big.NewInt(2))
	num.Add(num, r.Denom())
	den := new(big.Int).Mul(r.Denom(), big.NewInt(2))
	q := new(big.Int).Quo(num, den)
	s := q.String()
	if digits > 0 {
		if len(s) <= digits {
			s = strings.Repeat("0", digits-len(s)+1) + s
		}
		s = s[:len(s)-digits] + "." + s[len(s)-digits:]
	}
	if neg {
		s = "-" + s
	}
	return s
}

// pow10 is 10 ** k, correctly rounded.
func pow10(k int) float64 {
	f, _ := strconv.ParseFloat("1e"+strconv.Itoa(k), 64)
	return f
}

// jsKeys is Object.keys(m): array-index keys first, ascending, then the rest as written. raw is the JSON text m was
// decoded from (a decoded map has forgotten the order); without it the rest come sorted.
func jsKeys(m map[string]any, raw json.RawMessage) []string {
	if raw != nil {
		if keys := keyOrder(raw); len(keys) == len(m) {
			return keys
		}
	}
	keys := sortedKeys(m)
	index := func(k string) (uint64, bool) {
		if !indexRe.MatchString(k) {
			return 0, false
		}
		n, err := strconv.ParseUint(k, 10, 64)
		return n, err == nil && n < 4294967295
	}
	sort.SliceStable(keys, func(i, j int) bool {
		a, aOK := index(keys[i])
		b, bOK := index(keys[j])
		if aOK && bOK {
			return a < b
		}
		return aOK && !bOK
	})
	return keys
}

// rawKey and rawIndex walk JSON text without losing the order of the objects inside; nil when there is no such part.
func rawKey(raw json.RawMessage, key string) json.RawMessage {
	var m map[string]json.RawMessage
	if raw == nil || json.Unmarshal(raw, &m) != nil {
		return nil
	}
	return m[key]
}

func rawList(raw json.RawMessage) []json.RawMessage {
	var l []json.RawMessage
	if raw == nil || json.Unmarshal(raw, &l) != nil {
		return nil
	}
	return l
}

// utf16Compare orders strings as JavaScript's < does: by UTF-16 code unit, not by code point (they differ when
// one side has a character beyond U+FFFF and the other one in U+E000..U+FFFF).
func utf16Compare(a, b string) int {
	ra, rb := []rune(a), []rune(b)
	for i := 0; i < len(ra) && i < len(rb); i++ {
		x, y := ra[i], rb[i]
		if x == y {
			continue
		}
		if x > 0xffff && y <= 0xffff {
			x = 0xd800 // any high surrogate sorts the same against a single unit
		} else if y > 0xffff && x <= 0xffff {
			y = 0xd800
		}
		if x < y {
			return -1
		}
		return 1
	}
	return len(ra) - len(rb)
}

// jsonKey is JSON.stringify(v) as an identity: two JSON values get the same text exactly when JavaScript gives
// them the same text (-0 is 0). Object keys come sorted: the order they were written in is not known here.
func jsonKey(b *strings.Builder, v any) {
	switch x := v.(type) {
	case bool:
		b.WriteString(strconv.FormatBool(x))
	case float64:
		if isFinite(x) {
			b.WriteString(numberString(x))
		} else {
			b.WriteString("null")
		}
	case string:
		b.WriteString(strconv.Quote(x))
	case []any:
		b.WriteByte('[')
		for i, e := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			jsonKey(b, e)
		}
		b.WriteByte(']')
	case map[string]any:
		b.WriteByte('{')
		for i, k := range sortedKeys(x) {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteString(strconv.Quote(k))
			b.WriteByte(':')
			jsonKey(b, x[k])
		}
		b.WriteByte('}')
	default:
		b.WriteString("null")
	}
}
