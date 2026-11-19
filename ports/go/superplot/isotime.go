package superplot

import (
	"math"
	"regexp"
	"strconv"
)

var isoRe = regexp.MustCompile(`^(\d{4})-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?)?$`)

func daysFromCivil(y, m, d int64) int64 {
	if m <= 2 {
		y--
	}
	era := y / 400
	if y < 0 {
		era = (y - 399) / 400
	}
	yoe := y - era*400
	mm := m + 9
	if m > 2 {
		mm = m - 3
	}
	doy := (153*mm+2)/5 + d - 1
	doe := yoe*365 + yoe/4 - yoe/100 + doy
	return era*146097 + doe - 719468
}

func daysIn(year, month int64) int64 {
	switch month {
	case 2:
		if year%4 == 0 && (year%100 != 0 || year%400 == 0) {
			return 29
		}
		return 28
	case 4, 6, 9, 11:
		return 30
	}
	return 31
}

func atoi(s string) int64 {
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}

// toTime is a time as epoch ms from a number (taken as-is) or a strict ISO 8601 string; ok is false otherwise.
// Date-only strings are UTC midnight and a time without a zone is UTC.
func toTime(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, isFinite(x)
	case string:
		m := isoRe.FindStringSubmatch(jsTrim(x))
		if m == nil {
			return 0, false
		}
		year, month := atoi(m[1]), atoi(m[2])
		day := int64(1)
		if m[3] != "" {
			day = atoi(m[3])
		}
		if month < 1 || month > 12 || day < 1 || day > daysIn(year, month) {
			return 0, false
		}
		h, mi, sec := atoi(m[4]), atoi(m[5]), atoi(m[6])
		if h > 23 || mi > 59 || sec > 59 {
			return 0, false
		}
		var offset int64
		if m[8] != "" && m[8] != "Z" {
			z := m[8]
			if len(z) == 6 {
				z = z[:3] + z[4:]
			}
			oh, om := atoi(z[1:3]), atoi(z[3:5])
			if oh > 23 || om > 59 {
				return 0, false
			}
			offset = (oh*60 + om) * 60_000
			if z[0] == '-' {
				offset = -offset
			}
		}
		frac := m[7]
		for len(frac) < 3 {
			frac += "0"
		}
		ms := atoi(frac[:3])
		t := ((daysFromCivil(year, month, day)*24+h)*60+mi)*60_000 + sec*1000 + ms - offset
		return float64(t), !math.IsNaN(float64(t))
	}
	return 0, false
}
