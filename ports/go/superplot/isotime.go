// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
package superplot

import (
	"fmt"
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
		// A JavaScript Date holds at most 8.64e15 ms either side of 1970; beyond that it is not a time.
		return x, math.Abs(x) <= 8.64e15
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

func floorDiv(a, b int64) int64 {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

func civilFromDays(z int64) (y, m, d int64) {
	z += 719468
	era := floorDiv(z, 146097)
	doe := z - era*146097
	yoe := (doe - doe/1460 + doe/36524 - doe/146096) / 365
	doy := doe - (365*yoe + yoe/4 - yoe/100)
	mp := (5*doy + 2) / 153
	d = doy - (153*mp+2)/5 + 1
	m = mp - 9
	if mp < 10 {
		m = mp + 3
	}
	y = yoe + era*400
	if m <= 2 {
		y++
	}
	return y, m, d
}

// MinTime and MaxTime bound what timeUnit buckets: 0001-01-01 to the end of 9999, so every bucket is a four-digit
// ISO date that reads back as a time.
const (
	MinTime = -62135596800000
	MaxTime = 253402300799999
	dayMs   = 86_400_000
)

// TimeBucket is the start of the year, quarter, month, week, day or hour holding the epoch-ms time t (between
// MinTime and MaxTime), as timeUnit writes it: an ISO date in UTC ("2026-03-01"; hours as "2026-03-01T10:00:00Z").
// Weeks start on Monday. It mirrors bucket in transform.ts.
func TimeBucket(t float64, unit string) string {
	ms := int64(t) // new Date(t) drops the fraction, towards zero
	days := floorDiv(ms, dayMs)
	y, m, d := civilFromDays(days)
	day := func(yy, mm, dd int64) string {
		a, b, c := civilFromDays(daysFromCivil(yy, mm, 1) + dd - 1)
		return fmt.Sprintf("%04d-%02d-%02d", a, b, c)
	}
	switch unit {
	case "year":
		return fmt.Sprintf("%04d-01-01", y)
	case "quarter":
		return day(y, m-(m-1)%3, 1)
	case "month":
		return day(y, m, 1)
	case "week":
		return day(y, m, d-((days+3)%7+7)%7) // 1970-01-01 was a Thursday
	case "day":
		return day(y, m, d)
	}
	return fmt.Sprintf("%sT%02d:00:00Z", day(y, m, d), (ms-days*dayMs)/3_600_000)
}
