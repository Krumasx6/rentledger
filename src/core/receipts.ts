export type PaperWidth = 58 | 80;
export type BusinessInfo = {
  name: string;
  owner?: string;
  address: string;
  contact: string;
  footer: string;
};
export const defaultBusiness: BusinessInfo = {
  name: "RentLedger",
  owner: "",
  address: "",
  contact: "",
  footer: "Thank you for your payment!",
};
export type ReceiptSnapshot = {
  business: BusinessInfo;
  tenantName: string;
  room: string;
  month: string;
  charge: number;
  amount: number;
  remaining: number;
  date: string;
  time: string;
  recordedAt: string;
  method: string;
  reference: string;
  legacy: boolean;
};
export type Receipt = {
  id: string;
  ref: string;
  paymentId: string | null;
  revision: number;
  snapshot: string;
  voidReason: string;
  createdAt: string;
};
export type PrintStatus =
  "sending" | "transmitted" | "failed" | "unknown" | "skipped";
export type PrintAttempt = {
  id: string;
  receiptId: string;
  printer: string;
  status: PrintStatus;
  message: string;
  createdAt: string;
  finishedAt: string;
};
export const timeValid = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export function localTime(d = new Date()) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function ascii(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}
export function wrap(s: string, columns: number): string[] {
  let rest = ascii(s);
  const lines: string[] = [];
  while (rest.length > columns) {
    let split = rest.lastIndexOf(" ", columns);
    if (split <= 0) split = columns;
    lines.push(rest.slice(0, split));
    rest = rest.slice(split).trimStart();
  }
  if (rest) lines.push(rest);
  return lines;
}
export function receiptText(r: Receipt, width: PaperWidth): string {
  const d: ReceiptSnapshot = JSON.parse(r.snapshot);
  const cols = width === 58 ? 32 : 48;
  const line = "-".repeat(cols);
  const rows: string[] = [];
  const add = (s: string) => rows.push(...wrap(s, cols));
  const center = (s: string) => {
    for (const text of wrap(s, cols))
      rows.push(" ".repeat(Math.floor((cols - text.length) / 2)) + text);
  };
  const pesos = (n: number) =>
    `PHP ${(n / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const amountRow = (label: string, n: number) => {
    const value = pesos(n);
    if (label.length + value.length + 1 <= cols)
      rows.push(label + " ".repeat(cols - label.length - value.length) + value);
    else {
      add(label);
      rows.push(" ".repeat(Math.max(0, cols - value.length)) + value);
    }
  };
  center(d.business.name);
  if (d.business.owner) add(`Owner: ${d.business.owner}`);
  if (d.business.address) center(d.business.address);
  if (d.business.contact) center(d.business.contact);
  rows.push(line);
  center(r.voidReason ? "VOID / CORRECTED RECEIPT" : "RENT PAYMENT RECEIPT");
  add(`Reference: ${r.ref}`);
  if (r.revision > 1) add(`Correction revision: ${r.revision}`);
  add(`Payment date: ${d.date}`);
  add(`Payment time: ${d.time || "Not recorded"}`);
  if (d.recordedAt) add(`Recorded: ${d.recordedAt}`);
  add(`Tenant: ${d.tenantName}`);
  add(`Room / bed: ${d.room || "Not specified"}`);
  const [year, month] = d.month.split("-").map(Number);
  add(
    `Billing period: ${new Date(year, month - 1, 1).toLocaleDateString("en-PH", { month: "long", year: "numeric" })}`,
  );
  rows.push(line);
  amountRow("Rent charge:", d.charge);
  amountRow(
    "Previous payments:",
    Math.max(0, d.charge - d.remaining - d.amount),
  );
  amountRow("This payment:", d.amount);
  amountRow("Balance after payment:", d.remaining);
  add(`Status: ${d.remaining === 0 ? "FULLY PAID" : "PARTIAL"}`);
  add(`Method: ${d.method || "Not recorded"}`);
  if (d.reference) add(`Payment ref: ${d.reference}`);
  if (r.voidReason) add(`VOID: ${r.voidReason}`);
  if (d.legacy)
    add("Historical receipt: time and method may not have been recorded.");
  rows.push(line);
  center(d.business.footer);
  center("Rental payment acknowledgement");
  return rows.join("\n") + "\n";
}

// Digital copies preserve Unicode names; the thermal formatter deliberately
// transliterates to ASCII because generic printer code pages cannot render PHP's peso glyph reliably.
export function digitalReceiptText(r: Receipt): string {
  const d: ReceiptSnapshot = JSON.parse(r.snapshot);
  const pesos = (n: number) =>
    `PHP ${(n / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    [
      d.business.name,
      d.business.owner ? `Owner: ${d.business.owner}` : "",
      d.business.address,
      d.business.contact,
      "",
      r.voidReason ? "VOID / CORRECTED RECEIPT" : "RENT PAYMENT RECEIPT",
      `Reference: ${r.ref}`,
      `Revision: ${r.revision}`,
      `Payment date: ${d.date}`,
      `Payment time: ${d.time || "Not recorded"}`,
      `Recorded: ${d.recordedAt || "Not recorded"}`,
      `Tenant: ${d.tenantName}`,
      `Room / bed: ${d.room || "Not specified"}`,
      `Billing period: ${d.month}`,
      `Rent charge: ${pesos(d.charge)}`,
      `Previous payments: ${pesos(Math.max(0, d.charge - d.remaining - d.amount))}`,
      `This payment: ${pesos(d.amount)}`,
      `Balance after payment: ${pesos(d.remaining)}`,
      `Status: ${d.remaining === 0 ? "FULLY PAID" : "PARTIAL"}`,
      `Method: ${d.method || "Not recorded"}`,
      `Payment reference: ${d.reference || "None"}`,
      r.voidReason ? `VOID: ${r.voidReason}` : "",
      d.legacy
        ? "Historical record; original time/method may be unavailable."
        : "",
      "",
      d.business.footer,
      "Rental payment acknowledgement",
    ].join("\n") + "\n"
  );
}

export function validateReceiptSnapshot(
  value: unknown,
): value is ReceiptSnapshot {
  if (!value || typeof value !== "object") return false;
  const d = value as ReceiptSnapshot;
  const str = (s: unknown, n = 2000) => typeof s === "string" && s.length <= n;
  const integer = (v: unknown) =>
    Number.isSafeInteger(v) &&
    (v as number) >= 0 &&
    (v as number) <= 100000000000;
  return (
    !!d.business &&
    str(d.business.name, 120) &&
    !!d.business.name.trim() &&
    (d.business.owner === undefined || str(d.business.owner, 120)) &&
    str(d.business.address, 300) &&
    str(d.business.contact, 100) &&
    str(d.business.footer, 300) &&
    str(d.tenantName, 120) &&
    !!d.tenantName.trim() &&
    str(d.room, 120) &&
    str(d.month, 7) &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(d.month) &&
    integer(d.charge) &&
    d.charge > 0 &&
    integer(d.amount) &&
    d.amount > 0 &&
    d.amount <= d.charge &&
    integer(d.remaining) &&
    d.remaining <= d.charge - d.amount &&
    str(d.date, 10) &&
    /^\d{4}-\d{2}-\d{2}$/.test(d.date) &&
    str(d.time, 5) &&
    (d.time === "" || timeValid(d.time)) &&
    str(d.recordedAt, 40) &&
    str(d.method, 60) &&
    str(d.reference, 160) &&
    typeof d.legacy === "boolean"
  );
}
