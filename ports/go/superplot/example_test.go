// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
package superplot_test

import (
	"fmt"

	sp "github.com/super-solution/super-plot/ports/go/superplot"
)

func Example() {
	v := sp.ValidatePlot(`{"type":"bar","x":"region","y":"revenu","data":[{"region":"APAC","revenue":120}]}`)
	fmt.Println(v.OK)
	for _, i := range v.Issues {
		fmt.Println(i.Code, i.Path, i.Hint)
	}
	text, _ := sp.DescribePlot(`{"type":"bar","x":"region","y":"revenue","data":[{"region":"APAC","revenue":120}]}`)
	fmt.Println(text)
	// Output:
	// false
	// no_such_column y Did you mean "revenue"? Available columns: region, revenue.
	// Bar chart. 1 category. Highest: APAC (120). Total: 120.
}
