// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
// Types for size-budget.mjs (read by the tests).
export declare function overBudget(measured: Record<string, number>, budgets: Record<string, number>): { name: string; size: number; budget: number | 'none' }[]
