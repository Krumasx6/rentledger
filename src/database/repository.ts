import type { SQLiteDatabase } from "expo-sqlite";
import { randomUUID } from "expo-crypto";
import { schema, migrateV1ToV2, migrateV2ToV3, migrateV3ToV4 } from "./schema";
import { financialTotals, expenseBreakdown } from "../core/finances";
import {
  BusinessInfo,
  defaultBusiness,
  PrintAttempt,
  Receipt,
  ReceiptSnapshot,
  timeValid,
  localTime,
} from "../core/receipts";
import { PrintResult } from "../core/printing";
import {
  Backup,
  Expense,
  ExpenseInput,
  validateExpense,
  Charge,
  Entry,
  Payment,
  Rate,
  Tenant,
  checkPayment,
  currentMonth,
  dateValid,
  localDate,
  eligible,
  monthValid,
  rateFor,
  shiftMonth,
  validateBackup,
} from "../core/ledger";

// Every write uses this queue on the provider's single connection. This makes
// Expo's regular transaction helper safe from interleaved application writes,
// keeps connection-local foreign_keys enabled, and prevents double-tap races.
const queues = new WeakMap<SQLiteDatabase, Promise<void>>();
function atomic(
  db: SQLiteDatabase,
  task: (tx: SQLiteDatabase) => Promise<void>,
) {
  const previous = queues.get(db) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() =>
      db.withTransactionAsync(async () => {
        await task(db);
      }),
    );
  queues.set(db, next);
  return next;
}
export async function migrate(db: SQLiteDatabase) {
  await db.execAsync(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  const v = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version",
  );
  if ((v?.user_version || 0) > 4)
    throw new Error("This database needs a newer version of RentLedger.");
  if (!v?.user_version)
    await atomic(db, async (tx) => {
      await tx.execAsync(schema);
    });
  else if (v.user_version < 4)
    await atomic(db, async (tx) => {
      if (v.user_version === 1) await tx.execAsync(migrateV1ToV2);
      if (v.user_version < 3) {
        await tx.execAsync(migrateV2ToV3);
        await backfillReceipts(tx);
      }
      await tx.execAsync(migrateV3ToV4);
      if ((await tx.getAllAsync("PRAGMA foreign_key_check")).length)
        throw new Error("Database upgrade failed relationship validation.");
    });
  await atomic(db, async (tx) => {
    await tx.runAsync(
      "UPDATE print_attempts SET status='unknown',message='App closed while sending. Check paper before reprinting.',finishedAt=? WHERE status='sending'",
      new Date().toISOString(),
    );
  });
}
export const allTenants = (db: SQLiteDatabase) =>
  db.getAllAsync<Tenant>(
    "SELECT * FROM tenants ORDER BY endMonth IS NOT NULL,name COLLATE NOCASE",
  );
export const getExpense = (db: SQLiteDatabase, id: string) =>
  db.getFirstAsync<Expense>("SELECT * FROM expenses WHERE id=?", id);
export async function saveExpense(
  db: SQLiteDatabase,
  input: ExpenseInput,
  editing = false,
) {
  const e = validateExpense(input);
  await atomic(db, async (tx) => {
    if (editing) {
      const old = await getExpense(tx, e.id);
      if (!old) throw new Error("Expense no longer exists.");
      const updatedAt = new Date(
        Math.max(Date.now(), Date.parse(old.updatedAt)),
      ).toISOString();
      await tx.runAsync(
        "UPDATE expenses SET description=?,category=?,amount=?,date=?,notes=?,updatedAt=? WHERE id=?",
        e.description,
        e.category,
        e.amount,
        e.date,
        e.notes,
        updatedAt,
        e.id,
      );
    } else {
      const now = new Date().toISOString();
      await tx.runAsync(
        "INSERT INTO expenses(id,description,category,amount,date,notes,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)",
        e.id,
        e.description,
        e.category,
        e.amount,
        e.date,
        e.notes,
        now,
        now,
      );
    }
  });
}
export async function deleteExpense(db: SQLiteDatabase, id: string) {
  await atomic(db, async (tx) => {
    const result = await tx.runAsync("DELETE FROM expenses WHERE id=?", id);
    if (!result.changes) throw new Error("Expense no longer exists.");
  });
}
export type MonthlyFinances = ReturnType<typeof financialTotals> & {
  entries: Expense[];
  breakdown: ReturnType<typeof expenseBreakdown>;
};
export async function monthlyFinances(
  db: SQLiteDatabase,
  month: string,
): Promise<MonthlyFinances> {
  if (!monthValid(month)) throw new Error("Choose a valid month.");
  const start = `${month}-01`,
    end = `${shiftMonth(month, 1)}-01`;
  let report!: MonthlyFinances;
  await atomic(db, async (tx) => {
    const income = await tx.getFirstAsync<{ amount: number }>(
      "SELECT COALESCE(SUM(amount),0) amount FROM payments WHERE date>=? AND date<?",
      start,
      end,
    );
    const expenses = await tx.getFirstAsync<{ amount: number }>(
      "SELECT COALESCE(SUM(amount),0) amount FROM expenses WHERE date>=? AND date<?",
      start,
      end,
    );
    const rows = await tx.getAllAsync<Expense>(
      "SELECT * FROM expenses WHERE date>=? AND date<? ORDER BY date DESC,createdAt DESC,id",
      start,
      end,
    );
    report = {
      ...financialTotals(income?.amount || 0, expenses?.amount || 0),
      entries: rows,
      breakdown: expenseBreakdown(rows),
    };
  });
  return report;
}
export async function ensureMonth(db: SQLiteDatabase, month: string) {
  if (!monthValid(month)) throw new Error("Invalid billing month.");
  await atomic(db, async (tx) => {
    const tenants = await allTenants(tx);
    const rates = await tx.getAllAsync<Rate>("SELECT * FROM rates");
    for (const t of tenants)
      if (eligible(t, month)) {
        const r = rateFor(rates, t.id, month);
        if (!r) throw new Error("Missing rental rate.");
        await tx.runAsync(
          "INSERT OR IGNORE INTO charges(id,tenantId,month,amount,dueDay) VALUES(?,?,?,?,?)",
          randomUUID(),
          t.id,
          month,
          r.amount,
          r.dueDay,
        );
      }
  });
}
export async function entries(db: SQLiteDatabase, month: string) {
  await ensureMonth(db, month);
  return db.getAllAsync<Entry>(
    `SELECT c.*,t.name,t.room,COALESCE(SUM(p.amount),0) AS paid FROM charges c JOIN tenants t ON t.id=c.tenantId LEFT JOIN payments p ON p.chargeId=c.id WHERE c.month=? GROUP BY c.id ORDER BY (COALESCE(SUM(p.amount),0)>=c.amount),t.name COLLATE NOCASE`,
    month,
  );
}
export async function saveTenant(
  db: SQLiteDatabase,
  tenant: Tenant,
  isNew: boolean,
) {
  if (
    !tenant.name.trim() ||
    tenant.name.length > 120 ||
    !Number.isSafeInteger(tenant.rent) ||
    tenant.rent <= 0 ||
    !Number.isInteger(tenant.dueDay) ||
    tenant.dueDay < 1 ||
    tenant.dueDay > 31 ||
    !monthValid(tenant.startMonth)
  )
    throw new Error("Check the tenant name, rent, due day and start month.");
  await atomic(db, async (tx) => {
    if (isNew) {
      await tx.runAsync(
        "INSERT INTO tenants(id,name,room,rent,dueDay,contact,notes,startMonth,endMonth) VALUES(?,?,?,?,?,?,?,?,?)",
        tenant.id,
        tenant.name.trim(),
        tenant.room,
        tenant.rent,
        tenant.dueDay,
        tenant.contact,
        tenant.notes,
        tenant.startMonth,
        null,
      );
      await tx.runAsync(
        "INSERT INTO rates VALUES(?,?,?,?,?)",
        randomUUID(),
        tenant.id,
        tenant.startMonth,
        tenant.rent,
        tenant.dueDay,
      );
    } else {
      const old = await tx.getFirstAsync<Tenant>(
        "SELECT * FROM tenants WHERE id=?",
        tenant.id,
      );
      if (!old) throw new Error("Tenant no longer exists.");
      await tx.runAsync(
        "UPDATE tenants SET name=?,room=?,rent=?,dueDay=?,contact=?,notes=? WHERE id=?",
        tenant.name.trim(),
        tenant.room,
        tenant.rent,
        tenant.dueDay,
        tenant.contact,
        tenant.notes,
        tenant.id,
      );
      if (old.rent !== tenant.rent || old.dueDay !== tenant.dueDay) {
        const effective =
          tenant.startMonth > currentMonth()
            ? tenant.startMonth
            : shiftMonth(currentMonth(), 1);
        await tx.runAsync(
          "INSERT INTO rates VALUES(?,?,?,?,?) ON CONFLICT(tenantId,effectiveMonth) DO UPDATE SET amount=excluded.amount,dueDay=excluded.dueDay",
          randomUUID(),
          tenant.id,
          effective,
          tenant.rent,
          tenant.dueDay,
        );
      }
    }
  });
}
export async function archiveTenant(
  db: SQLiteDatabase,
  id: string,
  end: string,
) {
  if (!monthValid(end)) throw new Error("Enter a valid final billing month.");
  await atomic(db, async (tx) => {
    const t = await tx.getFirstAsync<Tenant>(
      "SELECT * FROM tenants WHERE id=?",
      id,
    );
    if (!t || end < t.startMonth)
      throw new Error("Final month cannot be earlier than the rental start.");
    const later = await tx.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) n FROM payments p JOIN charges c ON c.id=p.chargeId WHERE c.tenantId=? AND c.month>?",
      id,
      end,
    );
    if (later?.n)
      throw new Error(
        "There are payments after this month. Choose a later final month or correct those payments first.",
      );
    await tx.runAsync(
      "DELETE FROM charges WHERE tenantId=? AND month>?",
      id,
      end,
    );
    await tx.runAsync("UPDATE tenants SET endMonth=? WHERE id=?", end, id);
  });
}
export async function restoreTenant(db: SQLiteDatabase, id: string) {
  await atomic(db, async (tx) => {
    const result = await tx.runAsync(
      "UPDATE tenants SET endMonth=NULL WHERE id=? AND endMonth IS NOT NULL",
      id,
    );
    if (!result.changes) throw new Error("Archived tenant no longer exists.");
  });
}
export async function savePayment(
  db: SQLiteDatabase,
  p: Payment,
  edit = false,
) {
  if (!dateValid(p.date))
    throw new Error("Enter a valid payment date (YYYY-MM-DD).");
  if (p.time !== undefined && !timeValid(p.time) && !(edit && p.time === ""))
    throw new Error("Enter a valid payment time (HH:mm).");
  if (p.method !== undefined && !p.method.trim())
    throw new Error("Enter the payment method, such as Cash or GCash.");
  if ((p.method?.length || 0) > 60 || (p.reference?.length || 0) > 160)
    throw new Error("Payment method or reference is too long.");
  let receipt!: Receipt;
  await atomic(db, async (tx) => {
    const c = await tx.getFirstAsync<Charge>(
      "SELECT * FROM charges WHERE id=?",
      p.chargeId,
    );
    if (!c) throw new Error("Charge no longer exists.");
    if (
      edit &&
      !(await tx.getFirstAsync(
        "SELECT id FROM payments WHERE id=? AND chargeId=?",
        p.id,
        p.chargeId,
      ))
    )
      throw new Error("Payment no longer exists.");
    const sum = await tx.getFirstAsync<{ paid: number }>(
      "SELECT COALESCE(SUM(amount),0) paid FROM payments WHERE chargeId=? AND id<>?",
      p.chargeId,
      p.id,
    );
    checkPayment(p.amount, c.amount - (sum?.paid || 0));
    if (edit)
      await tx.runAsync(
        "UPDATE payments SET amount=?,date=?,note=?,method=?,reference=?,time=? WHERE id=?",
        p.amount,
        p.date,
        p.note,
        p.method || "Cash",
        p.reference || "",
        p.time ?? localTime(),
        p.id,
      );
    else
      await tx.runAsync(
        "INSERT INTO payments(id,chargeId,amount,date,note,method,reference,time,recordedAt) VALUES(?,?,?,?,?,?,?,?,?)",
        p.id,
        p.chargeId,
        p.amount,
        p.date,
        p.note,
        p.method || "Cash",
        p.reference || "",
        p.time ?? localTime(),
        `${localDate()} ${localTime()}`,
      );
    if (edit)
      await tx.runAsync(
        "UPDATE receipts SET voidReason='Payment corrected; replaced by a new revision.' WHERE paymentId=? AND voidReason=''",
        p.id,
      );
    receipt = await createReceipt(tx, p.id, false);
  });
  return receipt;
}
export async function deletePayment(db: SQLiteDatabase, id: string) {
  await atomic(db, async (tx) => {
    await tx.runAsync(
      "UPDATE receipts SET voidReason='Payment deleted after owner confirmation.' WHERE paymentId=? AND voidReason=''",
      id,
    );
    await tx.runAsync("DELETE FROM payments WHERE id=?", id);
  });
}
export async function exportData(db: SQLiteDatabase): Promise<Backup> {
  let result!: Backup;
  await atomic(db, async (tx) => {
    result = {
      schemaVersion: 4,
      exportedAt: new Date().toISOString(),
      tenants: await allTenants(tx),
      rates: await tx.getAllAsync("SELECT * FROM rates"),
      charges: await tx.getAllAsync("SELECT * FROM charges"),
      payments: await tx.getAllAsync("SELECT * FROM payments"),
      settings: await tx.getAllAsync("SELECT * FROM settings"),
      receipts: await tx.getAllAsync("SELECT * FROM receipts"),
      printAttempts: await tx.getAllAsync("SELECT * FROM print_attempts"),
      expenses: await tx.getAllAsync("SELECT * FROM expenses ORDER BY date,id"),
    };
  });
  return validateBackup(result);
}
export async function restoreData(db: SQLiteDatabase, input: unknown) {
  const b = validateBackup(input);
  await atomic(db, async (tx) => {
    await tx.execAsync(
      "DELETE FROM expenses; DELETE FROM print_attempts; DELETE FROM receipts; DELETE FROM payments; DELETE FROM charges; DELETE FROM rates; DELETE FROM tenants; DELETE FROM settings;",
    );
    for (const t of b.tenants)
      await tx.runAsync(
        "INSERT INTO tenants(id,name,room,rent,dueDay,contact,notes,startMonth,endMonth) VALUES(?,?,?,?,?,?,?,?,?)",
        t.id,
        t.name,
        t.room,
        t.rent,
        t.dueDay,
        t.contact,
        t.notes,
        t.startMonth,
        t.endMonth,
      );
    for (const r of b.rates)
      await tx.runAsync(
        "INSERT INTO rates VALUES(?,?,?,?,?)",
        r.id,
        r.tenantId,
        r.effectiveMonth,
        r.amount,
        r.dueDay,
      );
    for (const c of b.charges)
      await tx.runAsync(
        "INSERT INTO charges VALUES(?,?,?,?,?)",
        c.id,
        c.tenantId,
        c.month,
        c.amount,
        c.dueDay,
      );
    for (const p of b.payments)
      await tx.runAsync(
        "INSERT INTO payments(id,chargeId,amount,date,note,method,reference,time,recordedAt) VALUES(?,?,?,?,?,?,?,?,?)",
        p.id,
        p.chargeId,
        p.amount,
        p.date,
        p.note,
        p.method || "Not recorded",
        p.reference || "",
        p.time || "",
        p.recordedAt || "",
      );
    for (const s of b.settings)
      await tx.runAsync("INSERT INTO settings VALUES(?,?)", s.key, s.value);
    for (const r of b.receipts)
      await tx.runAsync(
        "INSERT INTO receipts VALUES(?,?,?,?,?,?,?)",
        r.id,
        r.ref,
        r.paymentId,
        r.revision,
        r.snapshot,
        r.voidReason,
        r.createdAt,
      );
    for (const a of b.printAttempts)
      await tx.runAsync(
        "INSERT INTO print_attempts(id,receiptId,printer,status,message,createdAt,finishedAt) VALUES(?,?,?,?,?,?,?)",
        a.id,
        a.receiptId,
        a.printer,
        a.status === "sending" ? "unknown" : a.status,
        a.message,
        a.createdAt,
        a.status === "sending" ? new Date().toISOString() : a.finishedAt,
      );
    for (const e of b.expenses)
      await tx.runAsync(
        "INSERT INTO expenses(id,description,category,amount,date,notes,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)",
        e.id,
        e.description,
        e.category,
        e.amount,
        e.date,
        e.notes,
        e.createdAt,
        e.updatedAt,
      );
    await backfillReceipts(tx);
    // Device identifiers and permissions do not transfer between phones.
    await tx.runAsync("DELETE FROM settings WHERE key='printer'");
    if ((await tx.getAllAsync("PRAGMA foreign_key_check")).length)
      throw new Error("Backup relationships failed verification.");
  });
}

export async function getSetting<T>(
  db: SQLiteDatabase,
  key: string,
  fallback: T,
): Promise<T> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key=?",
    key,
  );
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}
export async function setSetting(
  db: SQLiteDatabase,
  key: string,
  value: unknown,
) {
  const json = JSON.stringify(value);
  if (json.length > 2000) throw new Error("Settings are too long.");
  await atomic(db, async (tx) => {
    await tx.runAsync(
      "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      key,
      json,
    );
  });
}
export async function getBusiness(db: SQLiteDatabase) {
  const b = await getSetting(db, "business", defaultBusiness);
  if (
    !b ||
    typeof b.name !== "string" ||
    !b.name.trim() ||
    b.name.length > 120 ||
    (b.owner !== undefined &&
      (typeof b.owner !== "string" || b.owner.length > 120)) ||
    typeof b.address !== "string" ||
    b.address.length > 300 ||
    typeof b.contact !== "string" ||
    b.contact.length > 100 ||
    typeof b.footer !== "string" ||
    b.footer.length > 300
  )
    return { ...defaultBusiness };
  return { ...b, owner: b.owner || "" };
}
export async function saveBusiness(db: SQLiteDatabase, b: BusinessInfo) {
  if (
    !b.name.trim() ||
    b.name.length > 120 ||
    (b.owner !== undefined &&
      (typeof b.owner !== "string" || b.owner.length > 120)) ||
    b.address.length > 300 ||
    b.contact.length > 100 ||
    b.footer.length > 300
  )
    throw new Error(
      "Enter a business name; shorten business details to the limits shown.",
    );
  await setSetting(db, "business", {
    ...b,
    name: b.name.trim(),
    owner: (b.owner || "").trim(),
  });
}
async function createReceipt(
  tx: SQLiteDatabase,
  paymentId: string,
  legacy: boolean,
  legacyBalance?: number,
) {
  const row = await tx.getFirstAsync<
    Payment & {
      name: string;
      room: string;
      month: string;
      charge: number;
      paid: number;
    }
  >(
    `SELECT p.*,t.name,t.room,c.month,c.amount charge,(SELECT COALESCE(SUM(amount),0) FROM payments WHERE chargeId=c.id) paid FROM payments p JOIN charges c ON c.id=p.chargeId JOIN tenants t ON t.id=c.tenantId WHERE p.id=?`,
    paymentId,
  );
  if (!row) throw new Error("Saved payment could not be read for its receipt.");
  const revision = await tx.getFirstAsync<{ n: number }>(
    "SELECT COALESCE(MAX(revision),0)+1 n FROM receipts WHERE paymentId=?",
    paymentId,
  );
  const snapshot: ReceiptSnapshot = {
    business: await getBusiness(tx),
    tenantName: row.name,
    room: row.room,
    month: row.month,
    charge: row.charge,
    amount: row.amount,
    remaining: legacyBalance ?? Math.max(0, row.charge - row.paid),
    date: row.date,
    time: row.time || "",
    recordedAt: row.recordedAt || "",
    method: row.method || "Not recorded",
    reference: row.reference || "",
    legacy,
  };
  const id = randomUUID();
  const r: Receipt = {
    id,
    ref: `RL-${id.toUpperCase()}`,
    paymentId,
    revision: revision?.n || 1,
    snapshot: JSON.stringify(snapshot),
    voidReason: "",
    createdAt: new Date().toISOString(),
  };
  await tx.runAsync(
    "INSERT INTO receipts VALUES(?,?,?,?,?,?,?)",
    r.id,
    r.ref,
    r.paymentId,
    r.revision,
    r.snapshot,
    r.voidReason,
    r.createdAt,
  );
  return r;
}
async function backfillReceipts(tx: SQLiteDatabase) {
  const rows = await tx.getAllAsync<Payment & { charge: number }>(
    "SELECT p.*,c.amount charge FROM payments p JOIN charges c ON c.id=p.chargeId ORDER BY p.date,p.rowid",
  );
  const sums = new Map<string, number>();
  for (const p of rows) {
    const paid = (sums.get(p.chargeId) || 0) + p.amount;
    sums.set(p.chargeId, paid);
    if (
      !(await tx.getFirstAsync(
        "SELECT id FROM receipts WHERE paymentId=? AND voidReason=''",
        p.id,
      ))
    )
      await createReceipt(tx, p.id, true, Math.max(0, p.charge - paid));
  }
}
export const paymentReceipts = (db: SQLiteDatabase, paymentId: string) =>
  db.getAllAsync<Receipt>(
    "SELECT * FROM receipts WHERE paymentId=? ORDER BY revision DESC",
    paymentId,
  );
export const receiptAttempts = (db: SQLiteDatabase, id: string) =>
  db.getAllAsync<PrintAttempt>(
    "SELECT * FROM print_attempts WHERE receiptId=? ORDER BY createdAt DESC",
    id,
  );
export async function claimPrint(
  db: SQLiteDatabase,
  r: Receipt,
  printer: string,
  reprint: boolean,
) {
  let id: string | null = null;
  await atomic(db, async (tx) => {
    const current = await tx.getFirstAsync<Receipt>(
      "SELECT * FROM receipts WHERE id=?",
      r.id,
    );
    if (!current || current.voidReason)
      throw new Error("Receipt no longer active.");
    if (
      await tx.getFirstAsync(
        "SELECT id FROM print_attempts WHERE receiptId=? AND (status='sending' OR ?=0)",
        r.id,
        reprint ? 1 : 0,
      )
    )
      return;
    id = randomUUID();
    await tx.runAsync(
      "INSERT INTO print_attempts(id,receiptId,printer,status,message,createdAt,finishedAt) VALUES(?,?,?,?,?,?,?)",
      id,
      r.id,
      printer,
      "sending",
      "Checking printer connection.",
      new Date().toISOString(),
      "",
    );
  });
  return id;
}
export async function finishPrint(
  db: SQLiteDatabase,
  id: string,
  result: PrintResult,
) {
  await atomic(db, async (tx) => {
    await tx.runAsync(
      "UPDATE print_attempts SET status=?,message=?,finishedAt=? WHERE id=?",
      result.status,
      result.message,
      new Date().toISOString(),
      id,
    );
  });
}
