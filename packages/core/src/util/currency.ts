// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * Currency minor units (fraction digits) for `format: "currency:CODE"`.
 *
 * Written out instead of read from `Intl` at run time: the digits Intl reports come from the ICU/CLDR data of the
 * runtime and change between versions (Node 22 and Node 24 disagree on COP, HUF, IDR, PKR and RSD), so a chart, the
 * conformance data and the Go and Python ports would otherwise depend on which runtime drew them. Values: CLDR as
 * shipped with Node 24.12. Every code not listed here has 2. The list of known codes is in `currency-codes.ts`.
 */
const ZERO = new Set(('AFN ALL BIF CLP DJF GNF IQD IRR ISK JPY KMF KPW KRW LAK LBP MGA MMK PYG RSD RWF SLL SOS SYP UGX VND VUV XAF XOF XPF YER').split(' '))
const THREE = new Set(('BHD JOD KWD LYD OMR TND').split(' '))

/** Minor units of a currency code (upper case): 0, 2 or 3. Unknown codes get 2. */
export function currencyDigits(code: string): number {
  const c = code.toUpperCase()
  return ZERO.has(c) ? 0 : THREE.has(c) ? 3 : 2
}
