import {
  PrintAttempt,
  Receipt,
  ReceiptSnapshot,
  timeValid,
  validateReceiptSnapshot,
} from "./receipts";
export type Tenant = {
  id: string;
  name: string;
  room: string;
  rent: number;
  dueDay: number;
  contact: string;
  notes: string;
  startMonth: string;
  endMonth: string | null;
};
export type Rate = {
  id: string;
  tenantId: string;
  effectiveMonth: string;
  amount: number;
  dueDay: number;
};
export type Charge = {
  id: string;
  tenantId: string;
  month: string;
  amount: number;
  dueDay: number;
};
export type Payment = {
  id: string;
  chargeId: string;
  amount: number;
  date: string;
  note: string;
  method?: string;
  reference?: string;
  time?: string;
  recordedAt?: string;
};
export type Setting = { key: string; value: string };
export type Backup = {
  schemaVersion: 3;
  exportedAt: string;
  tenants: Tenant[];
  rates: Rate[];
  charges: Charge[];
  payments: Payment[];
  settings: Setting[];
  receipts: Receipt[];
  printAttempts: PrintAttempt[];
};
export type Entry = Charge & { name: string; room: string; paid: number };
export const monthValid = (s: string) =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(s) && s >= "1900-01" && s <= "2199-12";
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const currentMonth = () => localDate().slice(0, 7);
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return localDate(d).slice(0, 7);
}
export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-PH", {
    month: "long",
    year: "numeric",
  });
}
/** A recurring due day uses the last calendar day in shorter months. */
export function dueDate(month: string, dueDay: number) {
  if (
    !monthValid(month) ||
    !Number.isInteger(dueDay) ||
    dueDay < 1 ||
    dueDay > 31
  )
    throw new Error("Due day must be a whole number from 1 to 31.");
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return `${month}-${String(Math.min(dueDay, lastDay)).padStart(2, "0")}`;
}
export function dateValid(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !monthValid(s.slice(0, 7)))
    return false;
  const [y, m, d] = s.split("-").map(Number);
  return localDate(new Date(y, m - 1, d)) === s;
}
const recordedAtValid = (s: string) =>
  s === "" ||
  (s.length === 16 &&
    s[10] === " " &&
    dateValid(s.slice(0, 10)) &&
    timeValid(s.slice(11)));
export function money(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(value / 100);
}
export function cents(input: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(input.trim()))
    throw new Error(
      "Enter a positive peso amount with up to two decimal places.",
    );
  const [whole, fraction = ""] = input.trim().split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n <= 0 || n > 100000000000)
    throw new Error("Amount must be between ₱0.01 and ₱1,000,000,000.");
  return n;
}
export const remaining = (amount: number, paid: number) =>
  Math.max(0, amount - paid);
export const status = (amount: number, paid: number) =>
  paid === 0 ? "UNPAID" : paid < amount ? "PARTIAL" : "PAID";
export function checkPayment(amount: number, balance: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > balance)
    throw new Error(
      "Payment must be positive and cannot exceed the remaining balance.",
    );
}
export const eligible = (t: Tenant, month: string) =>
  month >= t.startMonth && (!t.endMonth || month <= t.endMonth);
export function rateFor(rates: Rate[], tenantId: string, month: string) {
  return rates
    .filter((r) => r.tenantId === tenantId && r.effectiveMonth <= month)
    .sort((a, b) => b.effectiveMonth.localeCompare(a.effectiveMonth))[0];
}
export function totals(entries: Entry[]) {
  const expected = entries.reduce((s, e) => s + e.amount, 0);
  const collected = entries.reduce((s, e) => s + e.paid, 0);
  return {
    expected,
    collected,
    remaining: entries.reduce((s, e) => s + remaining(e.amount, e.paid), 0),
    paid: entries.filter((e) => e.paid === e.amount).length,
    outstanding: entries.filter((e) => e.paid < e.amount).length,
    progress: expected ? Math.min(1, collected / expected) : 0,
  };
}

export function validateBackup(input: unknown): Backup {
  const fail = () => {
    throw new Error(
      "Invalid backup: structure, amounts, dates, or record relationships are inconsistent.",
    );
  };
  if (!input || typeof input !== "object") return fail();
  const b = input as Omit<Backup, "schemaVersion"> & { schemaVersion: unknown };
  if (
    (b.schemaVersion !== 1 && b.schemaVersion !== 2 && b.schemaVersion !== 3) ||
    typeof b.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(b.exportedAt))
  )
    return fail();
  for (const key of [
    "tenants",
    "rates",
    "charges",
    "payments",
    "settings",
  ] as const)
    if (!Array.isArray(b[key]) || b[key].length > 100000) return fail();
  const str = (v: unknown, max = 2000): v is string =>
    typeof v === "string" && v.length <= max;
  const id = (v: unknown): v is string =>
    str(v, 100) && /^[\w-]{1,100}$/.test(v);
  const amount = (v: unknown) =>
    Number.isSafeInteger(v) &&
    (v as number) > 0 &&
    (v as number) <= 100000000000;
  const day = (v: unknown) =>
    Number.isInteger(v) &&
    (v as number) >= 1 &&
    (v as number) <= (b.schemaVersion === 1 ? 28 : 31);
  for (const rows of [b.tenants, b.rates, b.charges, b.payments]) {
    const seen = new Set();
    for (const row of rows) {
      if (!row || !id(row.id) || seen.has(row.id)) return fail();
      seen.add(row.id);
    }
  }
  const tenants = new Map(b.tenants.map((t) => [t.id, t]));
  const charges = new Map(b.charges.map((c) => [c.id, c]));
  for (const t of b.tenants)
    if (
      !str(t.name, 120) ||
      !t.name.trim() ||
      !str(t.room, 120) ||
      !str(t.contact, 100) ||
      !str(t.notes) ||
      !amount(t.rent) ||
      !day(t.dueDay) ||
      !monthValid(t.startMonth) ||
      (t.endMonth !== null &&
        (!monthValid(t.endMonth) || t.endMonth < t.startMonth))
    )
      return fail();
  const rateKeys = new Set();
  for (const r of b.rates) {
    const key = `${r.tenantId}/${r.effectiveMonth}`;
    const t = tenants.get(r.tenantId);
    if (
      !t ||
      !monthValid(r.effectiveMonth) ||
      r.effectiveMonth < t.startMonth ||
      !amount(r.amount) ||
      !day(r.dueDay) ||
      rateKeys.has(key)
    )
      return fail();
    rateKeys.add(key);
  }
  for (const t of b.tenants)
    if (
      !b.rates.some(
        (r) => r.tenantId === t.id && r.effectiveMonth === t.startMonth,
      )
    )
      return fail();
  const pairs = new Set();
  for (const c of b.charges) {
    const t = tenants.get(c.tenantId);
    const pair = `${c.tenantId}/${c.month}`;
    if (
      !t ||
      !monthValid(c.month) ||
      !eligible(t, c.month) ||
      !amount(c.amount) ||
      !day(c.dueDay) ||
      pairs.has(pair)
    )
      return fail();
    pairs.add(pair);
  }
  const paid = new Map<string, number>();
  for (const p of b.payments) {
    if (
      !charges.has(p.chargeId) ||
      !amount(p.amount) ||
      !dateValid(p.date) ||
      !str(p.note) ||
      (p.method !== undefined && !str(p.method, 60)) ||
      (p.reference !== undefined && !str(p.reference, 160)) ||
      (p.time !== undefined &&
        (typeof p.time !== "string" ||
          (p.time !== "" && !timeValid(p.time)))) ||
      (p.recordedAt !== undefined &&
        (!str(p.recordedAt, 40) || !recordedAtValid(p.recordedAt)))
    )
      return fail();
    paid.set(p.chargeId, (paid.get(p.chargeId) || 0) + p.amount);
  }
  for (const [key, sum] of paid)
    if (sum > charges.get(key)!.amount) return fail();
  const keys = new Set();
  for (const s of b.settings) {
    if (!s || !str(s.key, 100) || !str(s.value) || keys.has(s.key))
      return fail();
    keys.add(s.key);
  }
  const receipts: Receipt[] = b.schemaVersion === 3 ? b.receipts : [];
  const attempts: PrintAttempt[] = b.schemaVersion === 3 ? b.printAttempts : [];
  if (
    !Array.isArray(receipts) ||
    !Array.isArray(attempts) ||
    receipts.length > 100000 ||
    attempts.length > 100000
  )
    return fail();
  const paymentMap = new Map(b.payments.map((p) => [p.id, p]));
  const receiptMap = new Map<string, Receipt>();
  const refs = new Set<string>();
  const active = new Set<string>();
  const revisions = new Set<string>();
  for (const r of receipts) {
    if (
      !r ||
      !id(r.id) ||
      receiptMap.has(r.id) ||
      !str(r.ref, 100) ||
      !/^RL-[\w-]+$/.test(r.ref) ||
      refs.has(r.ref) ||
      !Number.isSafeInteger(r.revision) ||
      r.revision < 1 ||
      !str(r.snapshot, 6000) ||
      !str(r.voidReason, 300) ||
      !str(r.createdAt, 40) ||
      !Number.isFinite(Date.parse(r.createdAt))
    )
      return fail();
    let snapshot: ReceiptSnapshot;
    try {
      snapshot = JSON.parse(r.snapshot);
    } catch {
      return fail();
    }
    if (
      !validateReceiptSnapshot(snapshot) ||
      !dateValid(snapshot.date) ||
      !recordedAtValid(snapshot.recordedAt) ||
      !monthValid(snapshot.month)
    )
      return fail();
    if (r.paymentId === null) {
      if (!r.voidReason) return fail();
    } else {
      const p = paymentMap.get(r.paymentId);
      const key = `${r.paymentId}/${r.revision}`;
      if (!p || revisions.has(key)) return fail();
      revisions.add(key);
      if (!r.voidReason) {
        if (active.has(r.paymentId)) return fail();
        active.add(r.paymentId);
        const c = charges.get(p.chargeId)!;
        if (
          snapshot.amount !== p.amount ||
          snapshot.date !== p.date ||
          snapshot.month !== c.month ||
          snapshot.charge !== c.amount ||
          snapshot.method !== (p.method || "Not recorded") ||
          snapshot.reference !== (p.reference || "") ||
          snapshot.time !== (p.time || "") ||
          snapshot.recordedAt !== (p.recordedAt || "")
        )
          return fail();
      }
    }
    receiptMap.set(r.id, r);
    refs.add(r.ref);
  }
  if (b.schemaVersion === 3 && b.payments.some((p) => !active.has(p.id)))
    return fail();
  const attemptIds = new Set();
  const sending = new Set();
  for (const a of attempts) {
    if (
      !a ||
      !id(a.id) ||
      attemptIds.has(a.id) ||
      !receiptMap.has(a.receiptId) ||
      !str(a.printer, 300) ||
      !["sending", "transmitted", "failed", "unknown", "skipped"].includes(
        a.status,
      ) ||
      !str(a.message) ||
      !str(a.createdAt, 40) ||
      !Number.isFinite(Date.parse(a.createdAt)) ||
      !str(a.finishedAt, 40) ||
      (a.status === "sending" ? a.finishedAt !== "" : a.finishedAt === "") ||
      (a.finishedAt !== "" && !Number.isFinite(Date.parse(a.finishedAt)))
    )
      return fail();
    if (a.status === "sending") {
      if (sending.has(a.receiptId)) return fail();
      sending.add(a.receiptId);
    }
    attemptIds.add(a.id);
  }
  return { ...b, schemaVersion: 3, receipts, printAttempts: attempts };
}
