import type { Expense } from "./ledger";
export const expenseCategories = [
  "Utilities",
  "Cleaning",
  "Repairs",
  "Supplies",
  "Other",
] as const;
export function financialTotals(income: number, expenses: number) {
  if (
    ![income, expenses].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    !Number.isSafeInteger(income - expenses)
  )
    throw new Error("Financial totals exceed the supported amount.");
  return { income, expenses, net: income - expenses };
}
export function expenseBreakdown(entries: Expense[]) {
  const categories = new Map<string, number>();
  for (const expense of entries) {
    const category = expense.category.trim() || "Other";
    const total = (categories.get(category) || 0) + expense.amount;
    if (!Number.isSafeInteger(total))
      throw new Error("Expense total exceeds the supported amount.");
    categories.set(category, total);
  }
  return [...categories]
    .map(([category, amount]) => ({ category, amount }))
    .sort(
      (a, b) => b.amount - a.amount || a.category.localeCompare(b.category),
    );
}
