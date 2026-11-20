// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * The cases over their budget (KB gzip), for `node scripts/size.mjs --check`. A case without a budget, or a
 * budget without a measurement, is an error too: the table and the budgets must name the same cases.
 */
export function overBudget(measured, budgets) {
  const out = []
  for (const [name, size] of Object.entries(measured)) {
    const budget = budgets[name]
    if (typeof budget !== 'number') out.push({ name, size, budget: 'none' })
    else if (size > budget) out.push({ name, size, budget })
  }
  for (const name of Object.keys(budgets)) if (!(name in measured)) out.push({ name, size: NaN, budget: budgets[name] })
  return out
}
