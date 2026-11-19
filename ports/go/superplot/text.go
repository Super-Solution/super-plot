package superplot

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Number and date text, English only. The reference implementation formats with Intl; here the same text is
// produced from first principles. Intl rounds the shortest decimal that round-trips the number (so 1.005 with
// two decimals is 1.01) and rounds half away from zero; both are reproduced. Other locales fall back to English.

//go:embed fields.v1.json
var fieldsJSON []byte

type fieldDef struct {
	Name     string   `json:"name"`
	Kind     string   `json:"kind"`
	Role     string   `json:"role"`
	Desc     string   `json:"desc"`
	Required bool     `json:"required"`
	Values   []string `json:"values"`
	Min      *float64 `json:"min"`
	Max      *float64 `json:"max"`
	Integer  bool     `json:"integer"`
	Default  any      `json:"default"`
}

type tables struct {
	Limits    map[string]int `json:"limits"`
	GeoLimits map[string]int `json:"geoLimits"`
	// Camera is the allowed range of each camera field.
	Camera     map[string][2]float64 `json:"camera"`
	Currencies map[string]struct {
		Symbol string `json:"symbol"`
		Digits int    `json:"digits"`
	} `json:"currencies"`
	Charts []struct {
		Type   string     `json:"type"`
		Fields []fieldDef `json:"fields"`
	} `json:"charts"`
}

var data = func() tables {
	var t tables
	if err := json.Unmarshal(fieldsJSON, &t); err != nil {
		panic("superplot: fields.v1.json: " + err.Error())
	}
	return t
}()

var formatRe = regexp.MustCompile(`^(auto|compact|integer|percent|fixed:\d{1,2}|currency:[A-Za-z]{3})$`)

// IsValueFormat reports whether s is a format string: auto | compact | integer | percent | fixed:N | currency:CODE.
func IsValueFormat(s string) bool { return formatRe.MatchString(s) }

// decimal is the shortest round-trip decimal of a number: value = 0.d1d2d3... x 10^pt.
type decimal struct {
	digits []byte
	pt     int
}

func shortest(v float64) decimal {
	s := strconv.FormatFloat(math.Abs(v), 'e', -1, 64) // d.ddde+XX
	mant, exp, _ := strings.Cut(s, "e")
	e, _ := strconv.Atoi(exp)
	digits := []byte(strings.Replace(mant, ".", "", 1))
	d := decimal{digits: digits, pt: e + 1}
	if len(digits) == 1 && digits[0] == '0' {
		return decimal{}
	}
	return d
}

func (d decimal) isZero() bool { return len(d.digits) == 0 }

// round to at most maxFrac places, half up.
func (d decimal) round(maxFrac int) decimal {
	keep := d.pt + maxFrac
	if keep < 0 {
		return decimal{}
	}
	if keep >= len(d.digits) {
		return d
	}
	up := d.digits[keep] >= '5'
	digits := append([]byte(nil), d.digits[:keep]...)
	pt := d.pt
	if up {
		i := len(digits) - 1
		for ; i >= 0; i-- {
			if digits[i] == '9' {
				digits[i] = '0'
			} else {
				digits[i]++
				break
			}
		}
		if i < 0 {
			digits = append([]byte{'1'}, digits...)
			pt++
		}
	}
	for len(digits) > 0 && digits[len(digits)-1] == '0' {
		digits = digits[:len(digits)-1]
	}
	if len(digits) == 0 {
		return decimal{}
	}
	return decimal{digits, pt}
}

// parts is the integer and fractional digits of the decimal.
func (d decimal) parts() (string, string) {
	if d.isZero() {
		return "0", ""
	}
	s := string(d.digits)
	switch {
	case d.pt <= 0:
		return "0", strings.Repeat("0", -d.pt) + s
	case d.pt >= len(s):
		return s + strings.Repeat("0", d.pt-len(s)), ""
	}
	return s[:d.pt], s[d.pt:]
}

func group(whole string) string {
	var out []string
	for len(whole) > 3 {
		out = append([]string{whole[len(whole)-3:]}, out...)
		whole = whole[:len(whole)-3]
	}
	return strings.Join(append([]string{whole}, out...), ",")
}

func plain(d decimal, minFrac, maxFrac int, grouping bool) string {
	whole, frac := d.round(maxFrac).parts()
	if len(frac) < minFrac {
		frac += strings.Repeat("0", minFrac-len(frac))
	}
	if grouping {
		whole = group(whole)
	}
	if frac != "" {
		return whole + "." + frac
	}
	return whole
}

func signed(v float64, body string) string {
	// Intl keeps the sign of a negative number that rounds to zero ("-0").
	if v < 0 {
		return "-" + body
	}
	return body
}

var suffixes = []string{"", "K", "M", "B", "T"}

func compact(v float64) string {
	d := shortest(v)
	if d.isZero() {
		return "0"
	}
	idx := max(0, min((d.pt-1)/3, 4))
	if d.pt-1 < 0 {
		idx = 0
	}
	var r decimal
	for {
		r = decimal{d.digits, d.pt - 3*idx}.round(1)
		if r.pt >= 4 && idx < 4 {
			idx++
			continue
		}
		break
	}
	whole, frac := r.parts()
	if len(whole) >= 5 { // compact notation groups only from five digits
		whole = group(whole)
	}
	if frac != "" {
		whole += "." + frac
	}
	return whole + suffixes[idx]
}

func percent(v float64, maxFrac int) string {
	d := shortest(v)
	if !d.isZero() {
		d.pt += 2
	}
	return plain(d, 0, maxFrac, true) + "%"
}

func currency(v float64, code string, maxFrac int) string {
	code = strings.ToUpper(code)
	info, ok := data.Currencies[code]
	if !ok {
		info.Symbol, info.Digits = code, 2
	}
	body := plain(shortest(v), min(info.Digits, maxFrac), maxFrac, true)
	// CLDR currency spacing: a symbol ending in a letter or punctuation ("CHF", "Cg.") is separated from the
	// number, one ending in a symbol character ("$", "CN¥") is not.
	sep := ""
	if info.Symbol != "" {
		last, _ := utf8.DecodeLastRuneInString(info.Symbol)
		if !unicode.In(last, unicode.S, unicode.Z) {
			sep = " "
		}
	}
	return info.Symbol + sep + body
}

// ValueFormatter returns a formatter for single values. format: auto | compact | integer | percent | fixed:N |
// currency:CODE; empty means auto.
func ValueFormatter(format string) func(float64) string {
	f := format
	if f == "" {
		f = "auto"
	}
	switch {
	case f == "compact":
		return func(v float64) string { return signed(v, compact(v)) }
	case f == "integer":
		return func(v float64) string { return signed(v, plain(shortest(v), 0, 0, true)) }
	case f == "percent":
		return func(v float64) string {
			mf := 1
			if math.Abs(v) < 0.1 {
				mf = 2
			}
			return signed(v, percent(v, mf))
		}
	case strings.HasPrefix(f, "fixed:"):
		n, _ := strconv.Atoi(f[6:])
		return func(v float64) string { return signed(v, plain(shortest(v), n, n, true)) }
	case strings.HasPrefix(f, "currency:"):
		code := f[9:]
		return func(v float64) string {
			mf := 2
			if math.Abs(v) >= 1000 {
				mf = 0
			}
			return signed(v, currency(v, code, mf))
		}
	}
	return func(v float64) string {
		a := math.Abs(v)
		digits := 1
		switch {
		case v == math.Trunc(v):
			digits = 0
		case a < 1:
			digits = 4
		case a < 100:
			digits = 2
		}
		return signed(v, plain(shortest(v), 0, digits, true))
	}
}

// FormatValue formats one value in a Super Plot format string.
func FormatValue(value float64, format string) string { return ValueFormatter(format)(value) }

// FormatPercent formats a ratio (0.25) as text ("25%") with up to digits decimals.
func FormatPercent(ratio float64, digits int) string { return signed(ratio, percent(ratio, digits)) }

var months = []string{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}

// civil converts a day count since 1970-01-01 to a proleptic Gregorian date.
func civil(days int64) (int64, int, int) {
	z := days + 719468
	era := z / 146097
	if z < 0 {
		era = (z - 146096) / 146097
	}
	doe := z - era*146097
	yoe := (doe - doe/1460 + doe/36524 - doe/146096) / 365
	y := yoe + era*400
	doy := doe - (365*yoe + yoe/4 - yoe/100)
	mp := (5*doy + 2) / 153
	d := int(doy - (153*mp+2)/5 + 1)
	m := int(mp + 3)
	if mp >= 10 {
		m = int(mp - 9)
	}
	if m <= 2 {
		y++
	}
	return y, m, d
}

// formatDate is "Aug 31, 2026" (UTC) for epoch milliseconds.
func formatDate(ms float64) string {
	y, m, d := civil(int64(math.Floor(ms / 86_400_000)))
	if y <= 0 {
		y = 1 - y // Intl prints the year of the era: year 0 is "1" (BC)
	}
	return fmt.Sprintf("%s %d, %d", months[m-1], d, y)
}
