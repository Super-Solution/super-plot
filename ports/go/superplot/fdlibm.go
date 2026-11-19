package superplot

import "math"

// The elementary functions as the reference's JavaScript engine computes them.
//
// V8 does not call the C library for Math.exp, Math.log, Math.log10, Math.cbrt and **: it carries its own port of
// fdlibm, whose results differ from Go's math package in the last bit for a share of inputs. A last bit decides
// which of two equal-looking densities is "the peak", or whether a range spans "at most three decades", so the
// ports compute these the same way, operation by operation. Each function names the fdlibm file it follows.
// Arguments outside the range a chart can produce (negative bases, NaN, infinities) fall back to math.
//
// mul keeps every product a rounded double: the Go compiler may otherwise fuse x*y+z into one operation on
// architectures that have one (arm64, ppc64, s390x), and that changes the last bit.

func mul(a, b float64) float64 { return float64(a * b) }

func words(x float64) (hi, lo uint32) {
	b := math.Float64bits(x)
	return uint32(b >> 32), uint32(b)
}

func fromWords(hi, lo uint32) float64 { return math.Float64frombits(uint64(hi)<<32 | uint64(lo)) }

// low0 is SET_LOW_WORD(x, 0).
func low0(x float64) float64 { return math.Float64frombits(math.Float64bits(x) &^ 0xFFFFFFFF) }

const (
	fdLn2Hi   = 6.93147180369123816490e-01
	fdLn2Lo   = 1.90821492927058770002e-10
	fdInvLn2  = 1.44269504088896338700e00
	fdP1      = 1.66666666666666019037e-01
	fdP2      = -2.77777777770155933842e-03
	fdP3      = 6.61375632143793436117e-05
	fdP4      = -1.65339022054652515390e-06
	fdP5      = 4.13813679705723846039e-08
	fdTwoM1k  = 9.33263618503218878990e-302
	fdLg1     = 6.666666666666735130e-01
	fdLg2     = 3.999999999940941908e-01
	fdLg3     = 2.857142874366239149e-01
	fdLg4     = 2.222219843214978396e-01
	fdLg5     = 1.818357216161805012e-01
	fdLg6     = 1.531383769920937332e-01
	fdLg7     = 1.479819860511658591e-01
	fdTwo54   = 1.80143985094819840000e16
	fdIvLn10  = 4.34294481903251816668e-01
	fdLog102H = 3.01029995663611771306e-01
	fdLog102L = 3.69423907715893078616e-13
	fdL1      = 5.99999999999994648725e-01
	fdL2      = 4.28571428578550184252e-01
	fdL3      = 3.33333329818377432918e-01
	fdL4      = 2.72728123808534006489e-01
	fdL5      = 2.30660745775561754067e-01
	fdL6      = 2.06975017800338417784e-01
	fdPLg2    = 6.93147180559945286227e-01
	fdPLg2H   = 6.93147182464599609375e-01
	fdPLg2L   = -1.90465429995776804525e-09
	fdOvt     = 8.0085662595372944372e-17
	fdCp      = 9.61796693925975554329e-01
	fdCpH     = 9.61796700954437255859e-01
	fdCpL     = -7.02846165095275826516e-09
	fdIvLn2   = 1.44269504088896338700e00
	fdIvLn2H  = 1.44269502162933349609e00
	fdIvLn2L  = 1.92596299112661746302e-08
)

// The constants above are untyped; these typed copies stop the compiler folding arithmetic on them at a
// precision a double does not have.
var (
	fdBp  = [2]float64{1.0, 1.5}
	fdDpH = [2]float64{0.0, 5.84962487220764160156e-01}
	fdDpL = [2]float64{0.0, 1.35003920212974897128e-08}
)

// fdPoly is the polynomial exp and pow share: t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5)))).
func fdPoly(t float64) float64 {
	p := float64(fdP4) + mul(t, fdP5)
	p = float64(fdP3) + mul(t, p)
	p = float64(fdP2) + mul(t, p)
	p = float64(fdP1) + mul(t, p)
	return mul(t, p)
}

// jsExp is Math.exp (fdlibm e_exp.c).
func jsExp(x float64) float64 {
	if x != x || math.IsInf(x, 1) {
		return x
	}
	if math.IsInf(x, -1) {
		return 0
	}
	hx, _ := words(x)
	xsb := int(hx >> 31)
	hx &= 0x7FFFFFFF
	if hx >= 0x40862E42 {
		if x > 7.09782712893383973096e02 {
			return math.Inf(1)
		}
		if x < -7.45133219101941108420e02 {
			return 0
		}
	}
	var hi, lo float64
	k := 0
	if hx > 0x3FD62E42 {
		if hx < 0x3FF0A2B2 {
			if x == 1.0 {
				return 2.718281828459045
			}
			if xsb != 0 {
				hi, lo = x+fdLn2Hi, -fdLn2Lo
			} else {
				hi, lo = x-fdLn2Hi, fdLn2Lo
			}
			k = 1 - xsb - xsb
		} else {
			half := 0.5
			if xsb != 0 {
				half = -0.5
			}
			k = int(mul(fdInvLn2, x) + half)
			t := float64(k)
			hi = x - mul(t, fdLn2Hi)
			lo = mul(t, fdLn2Lo)
		}
		x = hi - lo
	} else if hx < 0x3E300000 {
		return 1.0 + x
	}
	t := mul(x, x)
	var twopk float64
	if k >= -1021 {
		twopk = fromWords(uint32(0x3FF00000+(k<<20)), 0)
	} else {
		twopk = fromWords(uint32(0x3FF00000+((k+1000)<<20)), 0)
	}
	c := x - fdPoly(t)
	if k == 0 {
		return 1.0 - (mul(x, c)/(c-2.0) - x)
	}
	y := 1.0 - ((lo - mul(x, c)/(2.0-c)) - hi)
	if k >= -1021 {
		if k == 1024 {
			return mul(mul(y, 2.0), 8.98846567431158e307)
		}
		return mul(y, twopk)
	}
	return mul(mul(y, twopk), fdTwoM1k)
}

// jsLog is Math.log (fdlibm e_log.c).
func jsLog(x float64) float64 {
	if !(x > 0) || math.IsInf(x, 1) {
		switch {
		case x == 0:
			return math.Inf(-1)
		case math.IsInf(x, 1):
			return x
		}
		return math.NaN()
	}
	hxu, lx := words(x)
	k := int32(0)
	if hxu < 0x00100000 {
		k -= 54
		x = mul(x, fdTwo54)
		hxu, lx = words(x)
	}
	hx := int32(hxu)
	k += (hx >> 20) - 1023
	hx &= 0x000FFFFF
	i := (hx + 0x95F64) & 0x100000
	x = fromWords(uint32(hx|(i^0x3FF00000)), lx)
	k += i >> 20
	f := x - 1.0
	dk := float64(k)
	if (0x000FFFFF & (2 + hx)) < 3 {
		if f == 0 {
			if k == 0 {
				return 0
			}
			return mul(dk, fdLn2Hi) + mul(dk, fdLn2Lo)
		}
		r := mul(mul(f, f), 0.5-mul(0.33333333333333333, f))
		if k == 0 {
			return f - r
		}
		return mul(dk, fdLn2Hi) - ((r - mul(dk, fdLn2Lo)) - f)
	}
	s := f / (2.0 + f)
	z := mul(s, s)
	i = hx - 0x6147A
	w := mul(z, z)
	j := 0x6B851 - hx
	t1 := mul(w, fdLg2+mul(w, fdLg4+mul(w, fdLg6)))
	t2 := mul(z, fdLg1+mul(w, fdLg3+mul(w, fdLg5+mul(w, fdLg7))))
	r := t2 + t1
	if (i | j) > 0 {
		hfsq := mul(mul(0.5, f), f)
		if k == 0 {
			return f - (hfsq - mul(s, hfsq+r))
		}
		return mul(dk, fdLn2Hi) - ((hfsq - (mul(s, hfsq+r) + mul(dk, fdLn2Lo))) - f)
	}
	if k == 0 {
		return f - mul(s, f-r)
	}
	return mul(dk, fdLn2Hi) - ((mul(s, f-r) - mul(dk, fdLn2Lo)) - f)
}

// jsLog10 is Math.log10 (fdlibm e_log10.c).
func jsLog10(x float64) float64 {
	if !(x > 0) || math.IsInf(x, 1) {
		switch {
		case x == 0:
			return math.Inf(-1)
		case math.IsInf(x, 1):
			return x
		}
		return math.NaN()
	}
	hxu, lx := words(x)
	k := int32(0)
	if hxu < 0x00100000 {
		k -= 54
		x = mul(x, fdTwo54)
		hxu, lx = words(x)
	}
	hx := int32(hxu)
	k += (hx >> 20) - 1023
	i := int32(0)
	if k < 0 {
		i = 1
	}
	hx = (hx & 0x000FFFFF) | ((0x3FF - i) << 20)
	y := float64(k + i)
	x = fromWords(uint32(hx), lx)
	z := mul(y, fdLog102L) + mul(fdIvLn10, jsLog(x))
	return z + mul(y, fdLog102H)
}

// jsCbrt is Math.cbrt (FreeBSD s_cbrt.c).
func jsCbrt(x float64) float64 {
	if x != x || math.IsInf(x, 0) || x == 0 {
		return x
	}
	hx, _ := words(x)
	sign := hx & 0x80000000
	hx ^= sign
	var t float64
	if hx < 0x00100000 {
		t = mul(fromWords(0x43500000, 0), x)
		high, _ := words(t)
		t = fromWords(sign|((high&0x7FFFFFFF)/3+696219795), 0)
	} else {
		t = fromWords(sign|(hx/3+715094163), 0)
	}
	r := mul(mul(t, t), t/x)
	a := 1.87595182427177009643 + mul(r, -1.88497979543377169875+mul(r, 1.621429720105354466140))
	b := mul(mul(mul(r, r), r), -0.758397934778766047437+mul(r, 0.145996192886612446982))
	t = mul(t, a+b)
	t = math.Float64frombits((math.Float64bits(t) + 0x80000000) & 0xFFFFFFFFC0000000)
	s := mul(t, t)
	r = x / s
	w := t + t
	r = (r - t) / (w + r)
	return t + mul(t, r)
}

// jsPow is x ** y for a finite x above zero and a finite y (V8's copy of fdlibm e_pow.c, which differs from
// fdlibm in one line).
func jsPow(x, y float64) float64 {
	if !(x > 0) || math.IsInf(x, 1) || y != y || math.IsInf(y, 0) {
		return math.Pow(x, y)
	}
	hxu, lx := words(x)
	hyu, ly := words(y)
	hy := int32(hyu)
	ix := int32(hxu)
	iy := int32(hyu & 0x7FFFFFFF)
	if uint32(iy)|ly == 0 {
		return 1
	}
	if ly == 0 {
		if iy == 0x3FF00000 {
			if hy < 0 {
				return 1.0 / x
			}
			return x
		}
		if hy == 0x40000000 {
			return mul(x, x)
		}
		if hy == 0x3FE00000 {
			return math.Sqrt(x)
		}
	}
	ax := x
	if lx == 0 && ix == 0x3FF00000 {
		return 1
	}
	inf := math.Inf(1)
	var t1, t2 float64
	var n int32
	if iy > 0x41E00000 {
		if iy > 0x43F00000 {
			if ix <= 0x3FEFFFFF {
				if hy < 0 {
					return inf
				}
				return 0
			}
			if hy > 0 {
				return inf
			}
			return 0
		}
		if ix < 0x3FEFFFFF {
			if hy < 0 {
				return inf
			}
			return 0
		}
		if ix > 0x3FF00000 {
			if hy > 0 {
				return inf
			}
			return 0
		}
		t := ax - 1.0
		w := mul(mul(t, t), 0.5-mul(t, 0.3333333333333333333333-mul(t, 0.25)))
		u := mul(fdIvLn2H, t)
		v := mul(t, fdIvLn2L) - mul(w, fdIvLn2)
		t1 = low0(u + v)
		t2 = v - (t1 - u)
	} else {
		if ix < 0x00100000 {
			ax = mul(ax, 9007199254740992.0)
			n -= 53
			h, _ := words(ax)
			ix = int32(h)
		}
		n += (ix >> 20) - 0x3FF
		j := ix & 0x000FFFFF
		ix = j | 0x3FF00000
		k := 0
		switch {
		case j <= 0x3988E:
			k = 0
		case j < 0xBB67A:
			k = 1
		default:
			k = 0
			n++
			ix -= 0x00100000
		}
		_, alo := words(ax)
		ax = fromWords(uint32(ix), alo)
		u := ax - fdBp[k]
		v := 1.0 / (ax + fdBp[k])
		ss := mul(u, v)
		sH := low0(ss)
		tH := fromWords(uint32(((ix>>1)|0x20000000)+0x00080000+int32(k<<18)), 0)
		tL := ax - (tH - fdBp[k])
		sL := mul(v, (u-mul(sH, tH))-mul(sH, tL))
		s2 := mul(ss, ss)
		p := fdL5 + mul(s2, fdL6)
		p = fdL4 + mul(s2, p)
		p = fdL3 + mul(s2, p)
		p = fdL2 + mul(s2, p)
		p = fdL1 + mul(s2, p)
		r := mul(mul(s2, s2), p)
		r += mul(sL, sH+ss)
		s2 = mul(sH, sH)
		tH = low0(3.0 + s2 + r)
		tL = r - ((tH - 3.0) - s2)
		u = mul(sH, tH)
		v = mul(sL, tH) + mul(tL, ss)
		pH := low0(u + v)
		pL := v - (pH - u)
		zH := mul(fdCpH, pH)
		zL := mul(fdCpL, pH) + mul(pL, fdCp) + fdDpL[k]
		t := float64(n)
		t1 = low0(((zH + zL) + fdDpH[k]) + t)
		t2 = zL - (((t1 - t) - fdDpH[k]) - zH)
	}
	y1 := low0(y)
	pL := mul(y-y1, t1) + mul(y, t2)
	pH := mul(y1, t1)
	z := pL + pH
	ju, iu := words(z)
	j := int32(ju)
	if j >= 0x40900000 {
		if uint32(j-0x40900000)|iu != 0 || pL+fdOvt > z-pH {
			return inf
		}
	} else if (j & 0x7FFFFFFF) >= 0x4090CC00 {
		if (ju-0xC090CC00)|iu != 0 || pL <= z-pH {
			return 0
		}
	}
	i := j & 0x7FFFFFFF
	k := (i >> 20) - 0x3FF
	n = 0
	if i > 0x3FE00000 {
		n = j + (0x00100000 >> uint(k+1))
		k = ((n & 0x7FFFFFFF) >> 20) - 0x3FF
		t := fromWords(uint32(n&^(0x000FFFFF>>uint(k))), 0)
		n = ((n & 0x000FFFFF) | 0x00100000) >> uint(20-k)
		if j < 0 {
			n = -n
		}
		pH -= t
	}
	t := low0(pL + pH)
	u := mul(t, fdPLg2H)
	v := mul(pL-(t-pH), fdPLg2) + mul(t, fdPLg2L)
	z = u + v
	w := v - (z - u)
	t = mul(z, z)
	t1 = z - fdPoly(t)
	r := mul(z, t1) / ((t1 - 2.0) - (w + mul(z, w))) // as V8 has it; fdlibm subtracts (w + z*w) after dividing
	z = 1.0 - (r - z)
	zh, zl := words(z)
	j = int32(zh) + (n << 20)
	if (j >> 20) <= 0 {
		return math.Ldexp(z, int(n))
	}
	return fromWords(uint32(j), zl)
}
