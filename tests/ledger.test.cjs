const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const ts = require("typescript");

// Execute the actual repository against isolated SQLite. Only the native bridge
// and UUID provider are replaced; no app records or production database is used.
const cache = new Map();
function source(path) {
  const full = resolve(__dirname, "..", path + ".ts");
  if (cache.has(full)) return cache.get(full);
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(full, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const req = (name) =>
    name === "expo-crypto"
      ? { randomUUID }
      : name.startsWith(".")
        ? source(
            require("node:path").posix.normalize(
              require("node:path").posix.join(
                require("node:path").posix.dirname(path),
                name,
              ),
            ),
          )
        : require(name);
  new Function("require", "module", "exports", code)(
    req,
    module,
    module.exports,
  );
  cache.set(full, module.exports);
  return module.exports;
}
const core = source("src/core/ledger");
const repo = source("src/database/repository");
const receiptCore = source("src/core/receipts");
const printing = source("src/core/printing");
const { PrinterSession } = source("src/core/printerSession");
const finances = source("src/core/finances");
function database(filename = ":memory:") {
  const native = new DatabaseSync(filename);
  const db = {
    native,
    execAsync: async (sql) => native.exec(sql),
    runAsync: async (sql, ...args) => native.prepare(sql).run(...args),
    getFirstAsync: async (sql, ...args) => native.prepare(sql).get(...args),
    getAllAsync: async (sql, ...args) => native.prepare(sql).all(...args),
    withTransactionAsync: async (fn) => {
      native.exec("BEGIN IMMEDIATE");
      try {
        await fn();
        native.exec("COMMIT");
      } catch (e) {
        native.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return db;
}
const tenant = (overrides = {}) => ({
  id: randomUUID(),
  name: "Test Owner Tenant",
  room: "A-1",
  rent: 300000,
  dueDay: 5,
  contact: "",
  notes: "",
  startMonth: core.currentMonth(),
  endMonth: null,
  ...overrides,
});
const payment = (chargeId, amount, overrides = {}) => ({
  id: randomUUID(),
  chargeId,
  amount,
  date: core.localDate(),
  note: "",
  ...overrides,
});
async function setup(t) {
  const db = database();
  t.after(() => db.native.close());
  await repo.migrate(db);
  return db;
}

test("local month transitions, year boundaries and leap dates", () => {
  assert.equal(core.shiftMonth("2026-12", 1), "2027-01");
  assert.equal(core.shiftMonth("2026-01", -1), "2025-12");
  assert.equal(core.shiftMonth("2024-02", 1), "2024-03");
  assert.equal(core.localDate(new Date(2026, 0, 1, 0, 1)), "2026-01-01");
  assert.equal(core.dateValid("2024-02-29"), true);
  assert.equal(core.dateValid("2025-02-29"), false);
  assert.equal(core.monthValid("2026-13"), false);
});
test("money parsing uses exact centavos and rejects imprecise or invalid input", () => {
  assert.equal(core.cents("3000"), 300000);
  assert.equal(core.cents("0.29"), 29);
  assert.equal(core.cents("1.1"), 110);
  for (const s of [
    "0",
    "-1",
    "NaN",
    "Infinity",
    "1.005",
    "1e4",
    "1,000",
    "1000000001",
  ])
    assert.throws(() => core.cents(s));
  assert.equal(core.remaining(300000, 400000), 0);
  assert.equal(core.totals([]).progress, 0);
});
test("fresh migration has no production fixtures and foreign keys enabled", async (t) => {
  const db = await setup(t);
  await repo.migrate(db);
  assert.equal((await repo.allTenants(db)).length, 0);
  assert.equal((await db.getFirstAsync("PRAGMA foreign_keys")).foreign_keys, 1);
  assert.equal((await db.getFirstAsync("PRAGMA user_version")).user_version, 4);
});
test("initial start, idempotent charges, partial/full payments, overpayment and historical totals", async (t) => {
  const db = await setup(t);
  const person = tenant();
  await repo.saveTenant(db, person, true);
  assert.equal(
    (await repo.entries(db, core.shiftMonth(person.startMonth, -1))).length,
    0,
  );
  let rows = await repo.entries(db, person.startMonth);
  const charge = rows[0];
  await repo.ensureMonth(db, person.startMonth);
  assert.equal((await repo.entries(db, person.startMonth)).length, 1);
  assert.equal(core.status(charge.amount, charge.paid), "UNPAID");
  await repo.savePayment(db, payment(charge.id, 100000));
  rows = await repo.entries(db, person.startMonth);
  assert.equal(core.status(rows[0].amount, rows[0].paid), "PARTIAL");
  assert.equal(core.totals(rows).remaining, 200000);
  await assert.rejects(repo.savePayment(db, payment(charge.id, 200001)));
  await repo.savePayment(db, payment(charge.id, 200000));
  rows = await repo.entries(db, person.startMonth);
  assert.equal(core.status(rows[0].amount, rows[0].paid), "PAID");
  assert.equal(core.totals(rows).collected, 300000);
  assert.equal(core.totals(rows).remaining, 0);
  assert.equal(core.totals(rows).progress, 1);
  const next = await repo.entries(db, core.shiftMonth(person.startMonth, 1));
  assert.equal(next[0].paid, 0);
  assert.equal(next[0].amount, 300000);
  assert.equal((await repo.entries(db, person.startMonth))[0].paid, 300000);
  assert.throws(() =>
    db.native.prepare("DELETE FROM tenants WHERE id=?").run(person.id),
  );
});
test("rent changes preserve generated future charges and ungenerated prior months", async (t) => {
  const db = await setup(t);
  const now = core.currentMonth();
  const person = tenant({ startMonth: core.shiftMonth(now, -3) });
  await repo.saveTenant(db, person, true);
  const future = core.shiftMonth(now, 2);
  await repo.entries(db, future);
  await repo.saveTenant(db, { ...person, rent: 450000, dueDay: 10 }, false);
  assert.equal(
    (await repo.entries(db, core.shiftMonth(now, -1)))[0].amount,
    300000,
  );
  const next = (await repo.entries(db, core.shiftMonth(now, 1)))[0];
  assert.equal(next.amount, 450000);
  assert.equal(next.dueDay, 10);
  assert.equal((await repo.entries(db, future))[0].amount, 300000);
  assert.equal((await repo.entries(db, now))[0].amount, 300000);
});
test("archive preserves historical payments, removes only unpaid future charges and stops generation", async (t) => {
  const db = await setup(t);
  const person = tenant();
  await repo.saveTenant(db, person, true);
  const now = person.startMonth;
  const future = core.shiftMonth(now, 1);
  const c = (await repo.entries(db, now))[0];
  const later = (await repo.entries(db, future))[0];
  const p = payment(later.id, 1);
  await repo.savePayment(db, p);
  await assert.rejects(repo.archiveTenant(db, person.id, now));
  await repo.deletePayment(db, p.id);
  await repo.savePayment(db, payment(c.id, 100000));
  await repo.archiveTenant(db, person.id, now);
  assert.equal((await repo.entries(db, future)).length, 0);
  assert.equal((await repo.entries(db, now))[0].paid, 100000);
});
test("restoring an archived tenant reactivates future charge generation", async (t) => {
  const db = await setup(t);
  const person = tenant();
  await repo.saveTenant(db, person, true);
  const now = person.startMonth;
  const future = core.shiftMonth(now, 1);
  await repo.entries(db, now);
  await repo.archiveTenant(db, person.id, now);
  assert.equal((await repo.entries(db, future)).length, 0);
  await repo.restoreTenant(db, person.id);
  assert.equal((await repo.entries(db, future)).length, 1);
});
test("payment edit/delete updates totals and validates dates and balance", async (t) => {
  const db = await setup(t);
  const person = tenant();
  await repo.saveTenant(db, person, true);
  const c = (await repo.entries(db, person.startMonth))[0];
  const p = payment(c.id, 100000);
  await repo.savePayment(db, p);
  await repo.savePayment(db, { ...p, amount: 200000 }, true);
  assert.equal((await repo.entries(db, person.startMonth))[0].paid, 200000);
  await assert.rejects(repo.savePayment(db, { ...p, amount: 300001 }, true));
  await assert.rejects(
    repo.savePayment(db, payment(c.id, 100, { date: "2025-02-30" })),
  );
  await repo.deletePayment(db, p.id);
  assert.equal((await repo.entries(db, person.startMonth))[0].paid, 0);
});
test("database constraints reject duplicate charges and direct overpayments", async (t) => {
  const db = await setup(t);
  const person = tenant();
  await repo.saveTenant(db, person, true);
  const c = (await repo.entries(db, person.startMonth))[0];
  await assert.rejects(
    db.runAsync(
      "INSERT INTO charges VALUES(?,?,?,?,?)",
      randomUUID(),
      person.id,
      c.month,
      c.amount,
      c.dueDay,
    ),
  );
  await assert.rejects(
    db.runAsync(
      "INSERT INTO payments(id,chargeId,amount,date,note) VALUES(?,?,?,?,?)",
      randomUUID(),
      c.id,
      300001,
      core.localDate(),
      "",
    ),
  );
});
test("backup round trip preserves records, rates, settings and monthly summaries", async (t) => {
  const a = await setup(t);
  const b = await setup(t);
  const person = tenant();
  await repo.saveTenant(a, person, true);
  const c = (await repo.entries(a, person.startMonth))[0];
  await repo.savePayment(a, payment(c.id, 12345));
  await a.runAsync("INSERT INTO settings VALUES(?,?)", "currency", "PHP");
  const backup = JSON.parse(JSON.stringify(await repo.exportData(a)));
  await repo.restoreData(b, backup);
  assert.equal((await repo.entries(b, person.startMonth))[0].paid, 12345);
  assert.equal((await repo.allTenants(b))[0].name, person.name);
  const again = await repo.exportData(b);
  assert.equal(again.rates.length, 1);
  assert.equal(again.settings[0].value, "PHP");
});
test("invalid backup cannot wipe data; malformed IDs, relationships and totals are rejected", async (t) => {
  const db = await setup(t);
  const person = tenant();
  await repo.saveTenant(db, person, true);
  const c = (await repo.entries(db, person.startMonth))[0];
  const valid = await repo.exportData(db);
  const invalid = [
    null,
    {},
    { ...valid, schemaVersion: 99 },
    { ...valid, charges: [c, c] },
    { ...valid, payments: [payment("missing", 100)] },
    { ...valid, payments: [payment(c.id, 300001)] },
    { ...valid, tenants: [{ ...person, id: "unsafe id" }] },
    { ...valid, rates: [] },
    { ...valid, tenants: [{ ...person, rent: NaN }] },
  ];
  for (const b of invalid) await assert.rejects(repo.restoreData(db, b));
  assert.equal((await repo.allTenants(db)).length, 1);
});
test("restore rolls back all deletions and inserts if SQLite fails mid-transaction", async (t) => {
  const db = await setup(t);
  const person = tenant();
  await repo.saveTenant(db, person, true);
  await repo.entries(db, person.startMonth);
  const b = await repo.exportData(db);
  const original = db.runAsync;
  db.runAsync = async (sql, ...args) => {
    if (sql.startsWith("INSERT INTO rates"))
      throw new Error("simulated storage failure");
    return original(sql, ...args);
  };
  await assert.rejects(repo.restoreData(db, b));
  db.runAsync = original;
  assert.equal((await repo.allTenants(db))[0].id, person.id);
  assert.equal((await repo.entries(db, person.startMonth)).length, 1);
});

test("simultaneous saves are serialized and cannot overpay or duplicate charges", async (t) => {
  const db = await setup(t);
  const person = tenant();
  await repo.saveTenant(db, person, true);
  await Promise.all(
    Array.from({ length: 6 }, () => repo.ensureMonth(db, person.startMonth)),
  );
  const rows = await repo.entries(db, person.startMonth);
  assert.equal(rows.length, 1);
  const attempts = await Promise.allSettled([
    repo.savePayment(db, payment(rows[0].id, 200000)),
    repo.savePayment(db, payment(rows[0].id, 200000)),
  ]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await repo.entries(db, person.startMonth))[0].paid, 200000);
});

test("records survive closing and reopening a file-backed SQLite database", async () => {
  const { tmpdir } = require("node:os");
  const { unlinkSync, existsSync } = require("node:fs");
  const filename = require("node:path").join(
    tmpdir(),
    `rentledger-test-${randomUUID()}.db`,
  );
  let db = database(filename);
  try {
    await repo.migrate(db);
    const person = tenant();
    await repo.saveTenant(db, person, true);
    const charge = (await repo.entries(db, person.startMonth))[0];
    await repo.savePayment(db, payment(charge.id, 100000));
    db.native.close();
    db = database(filename);
    await repo.migrate(db);
    const rows = await repo.entries(db, person.startMonth);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].paid, 100000);
    assert.equal(core.totals(rows).remaining, 200000);
  } finally {
    db.native.close();
    for (const suffix of ["", "-wal", "-shm"])
      if (existsSync(filename + suffix)) unlinkSync(filename + suffix);
  }
});

test("future rental starts never create an early charge and invalid tenant terms are rejected", async (t) => {
  const db = await setup(t);
  const start = core.shiftMonth(core.currentMonth(), 3);
  const person = tenant({ startMonth: start });
  await repo.saveTenant(db, person, true);
  assert.equal((await repo.entries(db, core.currentMonth())).length, 0);
  assert.equal((await repo.entries(db, start))[0].amount, 300000);
  for (const invalid of [
    { name: "  " },
    { rent: Infinity },
    { rent: -1 },
    { dueDay: 32 },
    { dueDay: 1.5 },
    { startMonth: "2026-00" },
  ]) {
    await assert.rejects(repo.saveTenant(db, tenant(invalid), true));
  }
  assert.equal((await repo.allTenants(db)).length, 1);
});

test("mixed tenant totals and ordering use billing month rather than payment date", async (t) => {
  const db = await setup(t);
  const a = tenant({ name: "A Paid" });
  const b = tenant({ name: "Z Partial" });
  await repo.saveTenant(db, a, true);
  await repo.saveTenant(db, b, true);
  const rows = await repo.entries(db, a.startMonth);
  await repo.savePayment(
    db,
    payment(rows.find((c) => c.tenantId === a.id).id, 300000, {
      date: "2000-01-01",
    }),
  );
  await repo.savePayment(
    db,
    payment(rows.find((c) => c.tenantId === b.id).id, 100000),
  );
  const updated = await repo.entries(db, a.startMonth);
  assert.equal(updated[0].tenantId, b.id);
  assert.deepEqual(core.totals(updated), {
    expected: 600000,
    collected: 400000,
    remaining: 200000,
    paid: 1,
    outstanding: 1,
    progress: 2 / 3,
  });
});

test("due days 29–31 clamp to the last day in short months, including leap years", () => {
  for (const day of [29, 30, 31]) {
    assert.equal(core.dueDate("2026-02", day), "2026-02-28");
    assert.equal(core.dueDate("2024-02", day), "2024-02-29");
  }
  assert.equal(core.dueDate("2100-02", 31), "2100-02-28");
  assert.equal(core.dueDate("2000-02", 31), "2000-02-29");
  assert.equal(core.dueDate("2026-04", 31), "2026-04-30");
  assert.equal(core.dueDate("2026-12", 31), "2026-12-31");
  assert.equal(core.dueDate("2026-02", 15), "2026-02-15");
  for (const day of [0, 32, 1.5, NaN, Infinity])
    assert.throws(() => core.dueDate("2026-02", day));
});

test("late due days persist through charges, backup and restore without changing money", async (t) => {
  const db = await setup(t);
  const restored = await setup(t);
  for (const day of [29, 30, 31]) {
    const person = tenant({ dueDay: day, startMonth: "2024-01" });
    await repo.saveTenant(db, person, true);
  }
  const rows = await repo.entries(db, "2024-02");
  assert.deepEqual(rows.map((c) => c.dueDay).sort(), [29, 30, 31]);
  assert.equal(core.totals(rows).expected, 900000);
  for (const c of rows)
    assert.equal(core.dueDate(c.month, c.dueDay), "2024-02-29");
  const backup = await repo.exportData(db);
  assert.equal(backup.schemaVersion, 4);
  await repo.restoreData(restored, JSON.parse(JSON.stringify(backup)));
  assert.equal((await repo.entries(restored, "2024-02")).length, 3);
  assert.equal(
    core.totals(await repo.entries(restored, "2024-03")).expected,
    900000,
  );
});

async function legacyDatabase(t) {
  const db = database();
  t.after(() => db.native.close());
  await db.execAsync("PRAGMA foreign_keys=ON;");
  await db.execAsync(source("src/database/schema").schemaV1);
  const person = tenant();
  await repo.saveTenant(db, person, true);
  const c = (await repo.entries(db, person.startMonth))[0];
  const p = payment(c.id, 100000);
  await db.runAsync(
    "INSERT INTO payments(id,chargeId,amount,date,note) VALUES(?,?,?,?,?)",
    p.id,
    p.chargeId,
    p.amount,
    p.date,
    p.note,
  );
  await db.runAsync("INSERT INTO settings VALUES(?,?)", "currency", "PHP");
  return { db, person, c };
}

test("version-1 database upgrade preserves every record and enables 31 in all tables", async (t) => {
  const { db, person, c } = await legacyDatabase(t);
  const before = await legacySnapshot(db);
  await repo.migrate(db);
  await repo.migrate(db);
  const after = await legacySnapshot(db);
  for (const key of ["tenants", "rates", "charges", "payments", "settings"])
    assert.deepEqual(after[key], before[key]);
  assert.equal((await db.getFirstAsync("PRAGMA user_version")).user_version, 4);
  assert.equal((await db.getFirstAsync("PRAGMA foreign_keys")).foreign_keys, 1);
  assert.equal((await db.getAllAsync("PRAGMA foreign_key_check")).length, 0);
  await repo.saveTenant(db, { ...person, dueDay: 31 }, false);
  const next = (
    await repo.entries(db, core.shiftMonth(person.startMonth, 1))
  )[0];
  assert.equal(next.dueDay, 31);
  assert.equal((await repo.entries(db, person.startMonth))[0].dueDay, c.dueDay);
  assert.equal((await repo.entries(db, person.startMonth))[0].paid, 100000);
  await assert.rejects(
    db.runAsync(
      "INSERT INTO payments(id,chargeId,amount,date,note) VALUES(?,?,?,?,?)",
      randomUUID(),
      c.id,
      200001,
      core.localDate(),
      "",
    ),
  );
  await assert.rejects(
    db.runAsync(
      "INSERT INTO charges VALUES(?,?,?,?,?)",
      randomUUID(),
      person.id,
      next.month,
      300000,
      31,
    ),
  );
});

test("failed schema upgrade rolls back tables, data and version and can be retried", async (t) => {
  const { db, person } = await legacyDatabase(t);
  const before = await legacySnapshot(db);
  const original = db.execAsync;
  db.execAsync = async (sql) => {
    if (sql.includes("CREATE TEMP TABLE old_tenants")) {
      await original(sql.slice(0, sql.indexOf("INSERT INTO tenants SELECT")));
      throw new Error("simulated migration failure");
    }
    return original(sql);
  };
  await assert.rejects(repo.migrate(db));
  db.execAsync = original;
  assert.equal((await db.getFirstAsync("PRAGMA user_version")).user_version, 1);
  const after = await legacySnapshot(db);
  for (const key of ["tenants", "rates", "charges", "payments", "settings"])
    assert.deepEqual(after[key], before[key]);
  await repo.migrate(db);
  assert.equal((await repo.entries(db, person.startMonth))[0].paid, 100000);
});

test("version-1 JSON backups remain importable by version 4", async (t) => {
  const db = await setup(t);
  const restored = await setup(t);
  const person = tenant();
  await repo.saveTenant(db, person, true);
  await repo.entries(db, person.startMonth);
  const old = { ...(await repo.exportData(db)), schemaVersion: 1 };
  assert.equal(core.validateBackup(old).schemaVersion, 4);
  await repo.restoreData(restored, old);
  assert.equal((await repo.allTenants(restored))[0].id, person.id);
});

async function legacySnapshot(db) {
  return {
    tenants: await db.getAllAsync("SELECT * FROM tenants"),
    rates: await db.getAllAsync("SELECT * FROM rates"),
    charges: await db.getAllAsync("SELECT * FROM charges"),
    payments: await db.getAllAsync(
      "SELECT id,chargeId,amount,date,note FROM payments",
    ),
    settings: await db.getAllAsync("SELECT * FROM settings"),
  };
}

function printerFor(db, transport) {
  return new printing.PrintCoordinator(transport, {
    claim: (receipt, reprint) =>
      repo.claimPrint(db, receipt, "test-printer", reprint),
    finish: (id, result) => repo.finishPrint(db, id, result),
  });
}
async function paymentSetup(t) {
  const db = await setup(t);
  const person = tenant();
  await repo.saveTenant(db, person, true);
  const charge = (await repo.entries(db, person.startMonth))[0];
  return { db, person, charge };
}

test("successful payment commits before printing and records transmitted, not paper-printed", async (t) => {
  const { db, charge } = await paymentSetup(t);
  let sends = 0;
  const printer = printerFor(db, {
    isConnected: async () => true,
    write: async (text) => {
      assert.equal(
        (await db.getFirstAsync("SELECT COUNT(*) n FROM payments")).n,
        1,
      );
      assert.equal(
        (await db.getFirstAsync("SELECT COUNT(*) n FROM receipts")).n,
        1,
      );
      assert.match(text, /PHP 1,000.00/);
      sends++;
    },
  });
  const result = await printing.persistThenPrint(
    () =>
      repo.savePayment(
        db,
        payment(charge.id, 100000, {
          time: "14:30",
          method: "GCash",
          reference: "REF-123",
        }),
      ),
    (r) => printer.print(r, 58),
    true,
  );
  assert.equal(sends, 1);
  assert.equal(result.print.status, "transmitted");
  assert.ok(result.print.message.includes("Check the paper"));
  const snapshot = JSON.parse(result.receipt.snapshot);
  assert.equal(snapshot.remaining, 200000);
  assert.equal(snapshot.method, "GCash");
  assert.equal(snapshot.reference, "REF-123");
  assert.equal(
    (await repo.receiptAttempts(db, result.receipt.id))[0].status,
    "transmitted",
  );
});

test("printer disconnected during payment leaves one saved payment and a retryable receipt", async (t) => {
  const { db, charge } = await paymentSetup(t);
  let writes = 0;
  const printer = printerFor(db, {
    isConnected: async () => false,
    write: async () => {
      writes++;
    },
  });
  const result = await printing.persistThenPrint(
    () => repo.savePayment(db, payment(charge.id, 100000)),
    (r) => printer.print(r, 58),
    true,
  );
  assert.equal(result.print.status, "skipped");
  assert.equal(writes, 0);
  assert.equal((await repo.entries(db, core.currentMonth()))[0].paid, 100000);
  assert.equal((await repo.receiptAttempts(db, result.receipt.id)).length, 1);
});

test("failed financial persistence or receipt insertion never initiates printing", async (t) => {
  const { db, charge } = await paymentSetup(t);
  let writes = 0;
  const send = async () => {
    writes++;
  };
  await assert.rejects(
    printing.persistThenPrint(
      () => repo.savePayment(db, payment(charge.id, 300001)),
      send,
      true,
    ),
  );
  const original = db.runAsync;
  db.runAsync = async (sql, ...args) => {
    if (sql.startsWith("INSERT INTO receipts"))
      throw new Error("receipt disk failure");
    return original(sql, ...args);
  };
  await assert.rejects(
    printing.persistThenPrint(
      () => repo.savePayment(db, payment(charge.id, 100000)),
      send,
      true,
    ),
  );
  db.runAsync = original;
  assert.equal(writes, 0);
  assert.equal(
    (await db.getFirstAsync("SELECT COUNT(*) n FROM payments")).n,
    0,
  );
  assert.equal(
    (await db.getFirstAsync("SELECT COUNT(*) n FROM receipts")).n,
    0,
  );
});

test("interrupted transmission is unknown and never reverses the payment or auto-replays", async (t) => {
  const { db, charge } = await paymentSetup(t);
  const r = await repo.savePayment(db, payment(charge.id, 100000));
  let writes = 0;
  const printer = printerFor(db, {
    isConnected: async () => true,
    write: async () => {
      writes++;
      throw new Error("disconnected after partial bytes");
    },
  });
  assert.equal((await printer.print(r, 58)).status, "unknown");
  assert.equal((await printer.print(r, 58)).status, "skipped");
  assert.equal(writes, 1);
  assert.equal((await repo.entries(db, core.currentMonth()))[0].paid, 100000);
  assert.equal((await repo.receiptAttempts(db, r.id))[0].status, "unknown");
});

test("reprinting preserves original reference, tenant, business and financial snapshot", async (t) => {
  const { db, charge, person } = await paymentSetup(t);
  await repo.saveBusiness(db, {
    name: "Original House",
    address: "Street 1",
    contact: "09123",
    footer: "Thank you",
  });
  const r = await repo.savePayment(db, payment(charge.id, 100000));
  const sent = [];
  const printer = printerFor(db, {
    isConnected: async () => true,
    write: async (text) => {
      sent.push(text);
    },
  });
  await printer.print(r, 58);
  await repo.saveTenant(db, { ...person, name: "Changed Tenant" }, false);
  await repo.saveBusiness(db, {
    ...receiptCore.defaultBusiness,
    name: "Changed House",
  });
  await repo.savePayment(db, payment(charge.id, 200000));
  const original = (await repo.paymentReceipts(db, r.paymentId))[0];
  await printer.print(original, 58, true);
  assert.equal(original.ref, r.ref);
  assert.equal(sent[0], sent[1]);
  assert.match(sent[1], /Original House/);
  assert.match(sent[1], /PHP 2,000.00/);
  assert.equal(
    (await db.getFirstAsync("SELECT COUNT(*) n FROM payments")).n,
    2,
  );
});

test("duplicate payment submissions and concurrent print clicks cannot create duplicates", async (t) => {
  const { db, charge } = await paymentSetup(t);
  const p = payment(charge.id, 100000);
  const results = await Promise.allSettled([
    repo.savePayment(db, p),
    repo.savePayment(db, p),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await db.getFirstAsync("SELECT COUNT(*) n FROM receipts")).n,
    1,
  );
  const receipt = (await repo.paymentReceipts(db, p.id))[0];
  let release;
  let writes = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const printer = printerFor(db, {
    isConnected: async () => true,
    write: async () => {
      writes++;
      await gate;
    },
  });
  const first = printer.print(receipt, 58, true);
  const second = await printer.print(receipt, 58, true);
  assert.equal(second.status, "skipped");
  release();
  await first;
  assert.equal(writes, 1);
});

test("both paper layouts wrap long names and references and sanitize ESC/POS control injection", async (t) => {
  const { db, charge } = await paymentSetup(t);
  const r = await repo.savePayment(
    db,
    payment(charge.id, 100000, {
      method: "Bank transfer",
      reference: "A".repeat(120),
      time: "09:31",
    }),
  );
  const d = JSON.parse(r.snapshot);
  d.tenantName = "José " + "Verylongname".repeat(8) + "\u001b@";
  r.snapshot = JSON.stringify(d);
  for (const width of [58, 80]) {
    const text = receiptCore.receiptText(r, width);
    assert.ok(
      text.split("\n").every((line) => line.length <= (width === 58 ? 32 : 48)),
    );
    assert.ok(/^[\x20-\x7e\n]+$/.test(text));
    assert.match(text, /PHP/);
    assert.match(text, /09:31/);
    assert.match(text, /Rent charge/);
    assert.match(text, /Balance after payment/);
    assert.equal(text.includes("\u001b"), false);
  }
});

test("corrections void prior receipt and deletion retains voided receipt history", async (t) => {
  const { db, charge } = await paymentSetup(t);
  const p = payment(charge.id, 100000);
  const first = await repo.savePayment(db, p);
  const correction = await repo.savePayment(
    db,
    { ...p, amount: 200000, reference: "corrected" },
    true,
  );
  assert.notEqual(correction.ref, first.ref);
  assert.equal(correction.revision, 2);
  const history = await repo.paymentReceipts(db, p.id);
  assert.equal(history.length, 2);
  assert.ok(history[1].voidReason);
  await repo.deletePayment(db, p.id);
  const rows = await db.getAllAsync("SELECT * FROM receipts");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.paymentId === null && r.voidReason));
  assert.equal((await repo.entries(db, core.currentMonth()))[0].paid, 0);
});

test("receipts and print attempts survive backup restore with reference identity", async (t) => {
  const { db, charge } = await paymentSetup(t);
  const destination = await setup(t);
  const r = await repo.savePayment(db, payment(charge.id, 100000));
  const printer = printerFor(db, {
    isConnected: async () => true,
    write: async () => {},
  });
  await printer.print(r, 80);
  const backup = await repo.exportData(db);
  await repo.restoreData(destination, JSON.parse(JSON.stringify(backup)));
  assert.equal(
    (await repo.paymentReceipts(destination, r.paymentId))[0].ref,
    r.ref,
  );
  assert.equal(
    (await repo.receiptAttempts(destination, r.id))[0].status,
    "transmitted",
  );
  const invalid = {
    ...backup,
    receipts: [
      {
        ...backup.receipts[0],
        snapshot: JSON.stringify({
          ...JSON.parse(backup.receipts[0].snapshot),
          amount: 123,
        }),
      },
    ],
  };
  await assert.rejects(repo.restoreData(destination, invalid));
  assert.equal(
    (await repo.paymentReceipts(destination, r.paymentId))[0].ref,
    r.ref,
  );
});

test("version-2 upgrade adds legacy receipts without inventing time or method and recovers interrupted sends", async (t) => {
  const db = database();
  t.after(() => db.native.close());
  await db.execAsync("PRAGMA foreign_keys=ON;");
  await db.execAsync(source("src/database/schema").schemaV2);
  const person = tenant();
  await repo.saveTenant(db, person, true);
  const charge = (await repo.entries(db, person.startMonth))[0];
  const p = payment(charge.id, 100000);
  await db.runAsync(
    "INSERT INTO payments(id,chargeId,amount,date,note) VALUES(?,?,?,?,?)",
    p.id,
    p.chargeId,
    p.amount,
    p.date,
    p.note,
  );
  await repo.migrate(db);
  const r = (await repo.paymentReceipts(db, p.id))[0];
  const d = JSON.parse(r.snapshot);
  assert.equal(d.legacy, true);
  assert.equal(d.time, "");
  assert.equal(d.method, "Not recorded");
  assert.equal(d.remaining, 200000);
  await repo.claimPrint(db, r, "printer", false);
  await repo.migrate(db);
  assert.equal((await repo.receiptAttempts(db, r.id))[0].status, "unknown");
});

test("auto-print off and unexpected printer errors keep the successful payment result", async (t) => {
  const { db, charge } = await paymentSetup(t);
  let sends = 0;
  const disabled = await printing.persistThenPrint(
    () => repo.savePayment(db, payment(charge.id, 100000)),
    async () => {
      sends++;
    },
    false,
  );
  assert.equal(disabled.print.status, "skipped");
  assert.equal(sends, 0);
  const failed = await printing.persistThenPrint(
    () => repo.savePayment(db, payment(charge.id, 100000)),
    async () => {
      throw new Error("printer unavailable");
    },
    true,
  );
  assert.equal(failed.print.status, "failed");
  assert.equal((await repo.entries(db, core.currentMonth()))[0].paid, 200000);
});

function adapter(os, available, permission = "granted") {
  let requested = 0,
    loads = 0,
    connected = 0;
  const api = {
    initialize: async () => {},
    isConnected: async () => false,
    getPrinters: async () => [],
    connect: async () => {
      connected++;
    },
    disconnect: async () => {},
    printText: async () => {},
  };
  const rn = {
    Platform: { OS: os, Version: 31 },
    TurboModuleRegistry: { get: () => (available ? {} : null) },
    PermissionsAndroid: {
      PERMISSIONS: { BLUETOOTH_CONNECT: "connect" },
      RESULTS: { GRANTED: "granted", NEVER_ASK_AGAIN: "never_ask_again" },
      check: async () => false,
      request: async () => {
        requested++;
        return permission;
      },
    },
  };
  const file = resolve(__dirname, "../src/printing/bluetooth.ts");
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name) => {
      if (name === "react-native") return rn;
      if (name === "rn-escpos-printer") {
        loads++;
        return { EscPosPrinter: api };
      }
      throw new Error(name);
    },
    module,
    module.exports,
  );
  return {
    driver: module.exports.bluetooth,
    counts: () => ({ requested, loads, connected }),
  };
}

test("Expo Go safely avoids loading the enforcing native module", async () => {
  const { driver, counts } = adapter("android", false);
  assert.equal(driver.supported(), false);
  assert.equal(await driver.isConnected(), false);
  await assert.rejects(driver.discover(), /unavailable in this build/);
  assert.equal(counts().loads, 0);
});

test("Android denied permissions and incompatible iOS Classic printers are clearly rejected", async () => {
  const android = adapter("android", true, "never_ask_again");
  await assert.rejects(android.driver.discover(), /permission is blocked/);
  assert.equal(android.counts().loads, 0);
  assert.equal(android.counts().requested, 1);
  const ios = adapter("ios", true);
  await assert.rejects(
    ios.driver.connect({
      id: "classic",
      name: "Classic only",
      address: "MAC",
      transport: "bluetooth-classic",
      connected: false,
    }),
    /iOS requires writable BLE/,
  );
  assert.equal(ios.counts().connected, 0);
});

test("digital exports preserve complete Unicode names while thermal receipts stay ASCII", async (t) => {
  const { db, charge } = await paymentSetup(t);
  const r = await repo.savePayment(db, payment(charge.id, 100000));
  const data = JSON.parse(r.snapshot);
  data.tenantName = "José Niño 王";
  r.snapshot = JSON.stringify(data);
  assert.match(receiptCore.digitalReceiptText(r), /José Niño 王/);
  assert.ok(/^[\x20-\x7e\n]+$/.test(receiptCore.receiptText(r, 58)));
});

test("business owner details save, reload and remain immutable on issued receipts", async (t) => {
  const { db, charge } = await paymentSetup(t);
  const b = {
    name: "ABC Boarding House",
    owner: "Maria Dela Cruz",
    address: "Tacloban City, Leyte",
    contact: "09123456789",
    footer: "Thank you for paying!",
  };
  await repo.saveBusiness(db, b);
  assert.deepEqual(await repo.getBusiness(db), b);
  const first = await repo.savePayment(db, payment(charge.id, 100000));
  await repo.saveBusiness(db, { ...b, owner: "New Manager" });
  assert.equal(
    JSON.parse((await repo.paymentReceipts(db, first.paymentId))[0].snapshot)
      .business.owner,
    "Maria Dela Cruz",
  );
  await assert.rejects(repo.saveBusiness(db, { ...b, owner: "A".repeat(121) }));
  await db.runAsync(
    "UPDATE settings SET value=? WHERE key=?",
    JSON.stringify({
      name: b.name,
      address: b.address,
      contact: b.contact,
      footer: b.footer,
    }),
    "business",
  );
  assert.equal((await repo.getBusiness(db)).owner, "");
});

test("receipt owner, previous payments, month label and full/partial status use saved amounts", async (t) => {
  const { db, charge } = await paymentSetup(t);
  await repo.saveBusiness(db, {
    ...receiptCore.defaultBusiness,
    owner: "Maria Dela Cruz",
  });
  const first = await repo.savePayment(db, payment(charge.id, 100000));
  const last = await repo.savePayment(db, payment(charge.id, 200000));
  for (const width of [58, 80]) {
    const a = receiptCore.receiptText(first, width);
    const b = receiptCore.receiptText(last, width);
    assert.match(a, /Status: PARTIAL/);
    assert.match(b, /Status: FULLY PAID/);
    assert.match(b, /Owner: Maria Dela Cruz/);
    assert.match(b, /Previous payments:\s+PHP 1,000.00/);
    assert.ok(
      b.split("\n").every((line) => line.length <= (width === 58 ? 32 : 48)),
    );
  }
  assert.equal(JSON.parse(first.snapshot).remaining, 200000);
  assert.equal(JSON.parse(last.snapshot).remaining, 0);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("saving during an active reconnect waits and sends the saved receipt exactly once", async (t) => {
  const { db, charge } = await paymentSetup(t);
  const ready = deferred();
  let connected = false,
    writes = 0,
    connects = 0;
  const transport = {
    supported: () => true,
    isConnected: async () => connected,
    connect: async () => {
      connects++;
      await ready.promise;
      connected = true;
    },
    write: async () => {
      writes++;
    },
  };
  const session = new PrinterSession(transport, () => ({
    selected: { id: "saved" },
    reconnect: true,
  }));
  const background = session.run(() => transport.connect());
  const printer = printerFor(db, {
    ...transport,
    prepare: () => session.prepare(),
  });
  const resultPromise = printing.persistThenPrint(
    () => repo.savePayment(db, payment(charge.id, 100000)),
    (r) => printer.print(r, 58),
    true,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await repo.entries(db, core.currentMonth()))[0].paid, 100000);
  assert.equal(writes, 0);
  ready.resolve();
  await background;
  const result = await resultPromise;
  assert.equal(result.print.status, "transmitted");
  assert.equal(writes, 1);
  assert.equal(connects, 1);
  assert.equal(JSON.parse(result.receipt.snapshot).remaining, 200000);
  assert.equal((await printer.print(result.receipt, 58)).status, "skipped");
  assert.equal(writes, 1);
  assert.equal((await repo.receiptAttempts(db, result.receipt.id)).length, 1);
});

test("save and print reconnects the remembered printer before sending a full payment", async (t) => {
  const { db, charge } = await paymentSetup(t);
  let connected = false,
    connects = 0,
    writes = 0;
  const transport = {
    supported: () => true,
    isConnected: async () => connected,
    connect: async (device, request) => {
      assert.equal(device.id, "saved");
      assert.equal(request, false);
      assert.equal(
        (await db.getFirstAsync("SELECT COUNT(*) n FROM payments")).n,
        1,
      );
      connects++;
      connected = true;
    },
    write: async (text) => {
      assert.match(text, /FULLY PAID/);
      writes++;
    },
  };
  const session = new PrinterSession(transport, () => ({
    selected: { id: "saved" },
    reconnect: true,
  }));
  const printer = printerFor(db, {
    ...transport,
    prepare: () => session.prepare(),
  });
  await repo.setSetting(db, "printer", { autoPrint: true });
  const preferences = await repo.getSetting(db, "printer", {});
  let savedReceipt;
  const result = await printing.persistThenPrint(
    () => repo.savePayment(db, payment(charge.id, 300000)),
    (r) => printer.print(r, 80),
    preferences.autoPrint,
    (r) => {
      savedReceipt = r.id;
    },
  );
  assert.equal(savedReceipt, result.receipt.id);
  assert.equal(result.print.status, "transmitted");
  assert.equal(connects, 1);
  assert.equal(writes, 1);
  assert.equal(JSON.parse(result.receipt.snapshot).remaining, 0);
});

test("failed pre-print reconnect preserves the payment and explicit reprint uses its original receipt", async (t) => {
  const { db, charge } = await paymentSetup(t);
  let connected = false,
    writes = 0,
    connects = 0;
  const transport = {
    supported: () => true,
    isConnected: async () => connected,
    connect: async () => {
      connects++;
      throw new Error("Printer powered off");
    },
    write: async () => {
      writes++;
    },
  };
  const session = new PrinterSession(transport, () => ({
    selected: { id: "saved" },
    reconnect: true,
  }));
  const printer = printerFor(db, {
    ...transport,
    prepare: () => session.prepare(),
  });
  const result = await printing.persistThenPrint(
    () => repo.savePayment(db, payment(charge.id, 100000)),
    (r) => printer.print(r, 58),
    true,
  );
  assert.equal(result.print.status, "failed");
  assert.match(result.print.message, /powered off/);
  assert.equal(connects, 1);
  assert.equal(writes, 0);
  connected = true;
  assert.equal(
    (await printer.print(result.receipt, 58, true)).status,
    "transmitted",
  );
  assert.equal(writes, 1);
  assert.equal(
    (await db.getFirstAsync("SELECT COUNT(*) n FROM payments")).n,
    1,
  );
  assert.equal(
    (
      await db.getFirstAsync(
        "SELECT ref FROM receipts WHERE id=?",
        result.receipt.id,
      )
    ).ref,
    result.receipt.ref,
  );
});

test("preparation respects paused reconnect and never repeats an uncertain Bluetooth write", async (t) => {
  const { db, charge } = await paymentSetup(t);
  let connected = false,
    writes = 0,
    connects = 0;
  const transport = {
    supported: () => true,
    isConnected: async () => connected,
    connect: async () => {
      connects++;
      connected = true;
    },
    write: async () => {
      writes++;
      throw new Error("Connection lost during write");
    },
  };
  let reconnect = false;
  const session = new PrinterSession(transport, () => ({
    selected: { id: "saved" },
    reconnect,
  }));
  const printer = printerFor(db, {
    ...transport,
    prepare: () => session.prepare(),
  });
  const result = await printing.persistThenPrint(
    () => repo.savePayment(db, payment(charge.id, 100000)),
    (r) => printer.print(r, 58),
    true,
  );
  assert.equal(result.print.status, "skipped");
  assert.equal(connects, 0);
  assert.equal(writes, 0);
  reconnect = true;
  assert.equal(
    (await printer.print(result.receipt, 58, true)).status,
    "unknown",
  );
  assert.equal(connects, 1);
  assert.equal(writes, 1);
  assert.equal((await printer.print(result.receipt, 58)).status, "skipped");
  assert.equal(writes, 1);
});

test("failed payment persistence never waits for or starts a printer reconnect", async (t) => {
  const { db, charge } = await paymentSetup(t);
  let connects = 0;
  const transport = {
    supported: () => true,
    isConnected: async () => false,
    connect: async () => {
      connects++;
    },
    write: async () => {
      throw new Error("Must not write");
    },
  };
  const session = new PrinterSession(transport, () => ({
    selected: { id: "saved" },
    reconnect: true,
  }));
  const printer = printerFor(db, {
    ...transport,
    prepare: () => session.prepare(),
  });
  await assert.rejects(
    printing.persistThenPrint(
      () => repo.savePayment(db, payment(charge.id, 300001)),
      (r) => printer.print(r, 58),
      true,
    ),
  );
  assert.equal(connects, 0);
  assert.equal(
    (await db.getFirstAsync("SELECT COUNT(*) n FROM payments")).n,
    0,
  );
});

const expense = (overrides = {}) => ({
  id: randomUUID(),
  description: "Kuryente",
  category: "Utilities",
  amount: 125050,
  date: "2026-11-03",
  notes: "",
  ...overrides,
});

test("expense add/edit/delete uses exact centavos, stable identity, timestamps and date-based reports", async (t) => {
  const db = await setup(t);
  const e = expense({
    description: "  Cleaners' fee  ",
    category: " Cleaning ",
    notes: " weekly ",
  });
  await repo.saveExpense(db, e);
  const stored = await repo.getExpense(db, e.id);
  assert.equal(stored.description, "Cleaners' fee");
  assert.equal(stored.category, "Cleaning");
  assert.equal(stored.notes, "weekly");
  assert.equal(stored.amount, 125050);
  assert.ok(Date.parse(stored.createdAt));
  assert.equal((await repo.monthlyFinances(db, "2026-11")).net, -125050);
  await repo.saveExpense(
    db,
    { ...e, amount: 80025, date: "2026-12-01", category: "" },
    true,
  );
  const edited = await repo.getExpense(db, e.id);
  assert.equal(edited.createdAt, stored.createdAt);
  assert.ok(edited.updatedAt >= stored.updatedAt);
  assert.equal((await repo.monthlyFinances(db, "2026-11")).expenses, 0);
  const december = await repo.monthlyFinances(db, "2026-12");
  assert.equal(december.expenses, 80025);
  assert.deepEqual(december.breakdown, [{ category: "Other", amount: 80025 }]);
  await repo.deleteExpense(db, e.id);
  assert.equal(await repo.getExpense(db, e.id), undefined);
  assert.equal((await repo.monthlyFinances(db, "2026-12")).net, 0);
  await assert.rejects(repo.saveExpense(db, e, true), /no longer exists/);
});

test("expense validation and database constraints reject invalid amounts, descriptions, dates and duplicate IDs", async (t) => {
  const db = await setup(t),
    e = expense();
  for (const change of [
    { description: " " },
    { description: "x".repeat(161) },
    { amount: 0 },
    { amount: -1 },
    { amount: 0.5 },
    { amount: NaN },
    { amount: Infinity },
    { amount: "100" },
    { amount: 100000000001 },
    { date: "2026-02-30" },
    { date: "2025-02-29" },
    { category: "x".repeat(81) },
    { notes: [] },
    { notes: "x".repeat(2001) },
    { id: "bad id" },
  ])
    await assert.rejects(repo.saveExpense(db, { ...e, ...change }));
  const results = await Promise.allSettled([
    repo.saveExpense(db, e),
    repo.saveExpense(db, e),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await repo.monthlyFinances(db, "2026-11")).entries.length, 1);
  for (const amount of [0, -10, 1.5, 100000000001])
    await assert.rejects(
      db.runAsync(
        "INSERT INTO expenses VALUES(?,?,?,?,?,?,?,?)",
        randomUUID(),
        "Invalid",
        "",
        amount,
        "2026-11-03",
        "",
        "2026-11-03T00:00:00.000Z",
        "2026-11-03T00:00:00.000Z",
      ),
    );
});

test("cash income follows actual dates of late and partial payments without changing billing totals", async (t) => {
  const db = await setup(t),
    person = tenant({ startMonth: "2026-10" });
  await repo.saveTenant(db, person, true);
  const charge = (await repo.entries(db, "2026-10"))[0];
  await repo.savePayment(
    db,
    payment(charge.id, 100000, { date: "2026-11-03" }),
  );
  await repo.savePayment(db, payment(charge.id, 50000, { date: "2026-10-31" }));
  await repo.saveExpense(db, expense({ amount: 125000 }));
  assert.equal((await repo.monthlyFinances(db, "2026-10")).income, 50000);
  const november = await repo.monthlyFinances(db, "2026-11");
  assert.equal(november.income, 100000);
  assert.equal(november.expenses, 125000);
  assert.equal(november.net, -25000);
  const billed = core.totals(await repo.entries(db, "2026-10"));
  assert.equal(billed.collected, 150000);
  assert.equal(billed.remaining, 150000);
  assert.equal(core.totals(await repo.entries(db, "2026-11")).collected, 0);
  await repo.archiveTenant(db, person.id, "2026-10");
  assert.equal((await repo.monthlyFinances(db, "2026-11")).income, 100000);
});

test("payment corrections and deletion update cash reports without counting voided receipts", async (t) => {
  const db = await setup(t),
    person = tenant({ startMonth: "2026-10" });
  await repo.saveTenant(db, person, true);
  const c = (await repo.entries(db, "2026-10"))[0];
  const p = payment(c.id, 100000, { date: "2026-11-01" });
  await repo.savePayment(db, p);
  await repo.savePayment(
    db,
    { ...p, date: "2026-12-01", amount: 150000 },
    true,
  );
  assert.equal((await repo.monthlyFinances(db, "2026-11")).income, 0);
  assert.equal((await repo.monthlyFinances(db, "2026-12")).income, 150000);
  assert.equal((await repo.paymentReceipts(db, p.id)).length, 2);
  await repo.deletePayment(db, p.id);
  assert.equal((await repo.monthlyFinances(db, "2026-12")).income, 0);
  assert.equal((await repo.entries(db, "2026-10"))[0].paid, 0);
});

test("expense reports preserve December, January, leap day and final supported month independently", async (t) => {
  const db = await setup(t);
  for (const [date, amount] of [
    ["2026-12-31", 10025],
    ["2027-01-01", 20050],
    ["2024-02-29", 30075],
    ["2199-12-31", 40100],
  ])
    await repo.saveExpense(db, expense({ date, amount }));
  for (const [month, amount] of [
    ["2026-12", 10025],
    ["2027-01", 20050],
    ["2024-02", 30075],
    ["2199-12", 40100],
  ])
    assert.equal((await repo.monthlyFinances(db, month)).expenses, amount);
  assert.deepEqual(finances.financialTotals(0, 0), {
    income: 0,
    expenses: 0,
    net: 0,
  });
  await assert.rejects(repo.monthlyFinances(db, "2026-13"));
  assert.throws(() => finances.financialTotals(NaN, 0));
  assert.throws(() => finances.financialTotals(Number.MAX_SAFE_INTEGER + 1, 0));
  assert.equal(finances.financialTotals(5000, 15000).net, -10000);
});

test("category breakdown supports defaults and custom descriptions with exact sums", async (t) => {
  const db = await setup(t);
  for (const e of [
    expense({ description: "Tubig", amount: 10001 }),
    expense({ description: "Kuryente", amount: 20002 }),
    expense({ description: "Cleaners", category: "Cleaning", amount: 5000 }),
    expense({ category: "", amount: 1000 }),
    expense({ category: "Security", amount: 2000 }),
  ])
    await repo.saveExpense(db, e);
  const r = await repo.monthlyFinances(db, "2026-11");
  assert.equal(r.expenses, 38003);
  assert.deepEqual(r.breakdown, [
    { category: "Utilities", amount: 30003 },
    { category: "Cleaning", amount: 5000 },
    { category: "Security", amount: 2000 },
    { category: "Other", amount: 1000 },
  ]);
  assert.deepEqual(finances.expenseCategories, [
    "Utilities",
    "Cleaning",
    "Repairs",
    "Supplies",
    "Other",
  ]);
});

test("version-3 migration preserves financial, receipt, business and printer records and rolls back on failure", async (t) => {
  const db = database();
  t.after(() => db.native.close());
  await db.execAsync("PRAGMA foreign_keys=ON;");
  await db.execAsync(source("src/database/schema").schemaV3);
  const person = tenant();
  await repo.saveTenant(db, person, true);
  const c = (await repo.entries(db, person.startMonth))[0];
  await repo.savePayment(db, payment(c.id, 100000));
  await repo.setSetting(db, "business", { name: "Original boarding house" });
  await repo.setSetting(db, "printer", {
    selected: { id: "original" },
    autoPrint: true,
  });
  const before = await legacySnapshot(db);
  const receipts = await db.getAllAsync("SELECT * FROM receipts");
  const original = db.execAsync;
  db.execAsync = async (sql) => {
    if (sql.includes("CREATE TABLE expenses")) {
      await original(sql);
      throw new Error("Simulated expense migration failure");
    }
    return original(sql);
  };
  await assert.rejects(repo.migrate(db));
  db.execAsync = original;
  assert.equal((await db.getFirstAsync("PRAGMA user_version")).user_version, 3);
  assert.equal(
    (
      await db.getFirstAsync(
        "SELECT COUNT(*) n FROM sqlite_master WHERE name='expenses'",
      )
    ).n,
    0,
  );
  assert.deepEqual(await legacySnapshot(db), before);
  await repo.migrate(db);
  await repo.migrate(db);
  assert.equal((await db.getFirstAsync("PRAGMA user_version")).user_version, 4);
  assert.deepEqual(await legacySnapshot(db), before);
  assert.deepEqual(await db.getAllAsync("SELECT * FROM receipts"), receipts);
  assert.equal(
    (await repo.monthlyFinances(db, core.currentMonth())).income,
    100000,
  );
  assert.equal(
    (await repo.monthlyFinances(db, core.currentMonth())).expenses,
    0,
  );
});

test("expense backup round trip, version-3 compatibility and invalid restore protection", async (t) => {
  const db = await setup(t),
    restored = await setup(t);
  const person = tenant({ startMonth: "2026-10" });
  await repo.saveTenant(db, person, true);
  const charge = (await repo.entries(db, "2026-10"))[0];
  await repo.savePayment(
    db,
    payment(charge.id, 100000, { date: "2026-11-03" }),
  );
  await repo.saveExpense(db, expense());
  const backup = await repo.exportData(db);
  assert.equal(backup.schemaVersion, 4);
  await repo.restoreData(restored, JSON.parse(JSON.stringify(backup)));
  assert.deepEqual((await repo.exportData(restored)).expenses, backup.expenses);
  assert.deepEqual((await repo.exportData(restored)).receipts, backup.receipts);
  assert.equal(
    (await repo.monthlyFinances(restored, "2026-11")).income,
    100000,
  );
  for (const change of [
    null,
    { ...backup.expenses[0], amount: 0 },
    { ...backup.expenses[0], amount: 1.5 },
    { ...backup.expenses[0], date: "2026-02-30" },
    { ...backup.expenses[0], createdAt: "bad" },
    { ...backup.expenses[0], createdAt: "2026-02-30T00:00:00.000Z" },
    { ...backup.expenses[0], updatedAt: "2000-01-01T00:00:00.000Z" },
  ]) {
    await assert.rejects(
      repo.restoreData(restored, { ...backup, expenses: [change] }),
    );
    assert.deepEqual(
      (await repo.exportData(restored)).expenses,
      backup.expenses,
    );
  }
  await assert.rejects(
    repo.restoreData(restored, {
      ...backup,
      expenses: [backup.expenses[0], backup.expenses[0]],
    }),
  );
  await assert.rejects(
    repo.restoreData(restored, { ...backup, expenses: undefined }),
  );
  const old = { ...backup, schemaVersion: 3 };
  delete old.expenses;
  assert.deepEqual(core.validateBackup(old).expenses, []);
  await repo.restoreData(restored, old);
  assert.equal((await repo.monthlyFinances(restored, "2026-11")).expenses, 0);
  assert.equal(
    (await repo.monthlyFinances(restored, "2026-11")).income,
    100000,
  );
});

test("restore failure inserting expenses rolls back existing expenses, payments and receipts", async (t) => {
  const sourceDb = await setup(t),
    target = await setup(t);
  await repo.saveExpense(sourceDb, expense());
  await repo.saveExpense(
    target,
    expense({ description: "Keep this", amount: 5000 }),
  );
  const person = tenant();
  await repo.saveTenant(target, person, true);
  const c = (await repo.entries(target, person.startMonth))[0];
  await repo.savePayment(target, payment(c.id, 100000));
  const before = await repo.exportData(target),
    backup = await repo.exportData(sourceDb),
    original = target.runAsync;
  target.runAsync = async (sql, ...args) => {
    if (sql.startsWith("INSERT INTO expenses"))
      throw new Error("Simulated restore failure");
    return original(sql, ...args);
  };
  await assert.rejects(repo.restoreData(target, backup));
  target.runAsync = original;
  const after = await repo.exportData(target);
  for (const key of ["expenses", "payments", "receipts", "tenants"])
    assert.deepEqual(after[key], before[key]);
});

test("expenses and historical cash reports survive closing and reopening SQLite", async () => {
  const { join } = require("node:path"),
    { tmpdir } = require("node:os"),
    { unlinkSync, existsSync } = require("node:fs");
  const file = join(tmpdir(), `rentledger-expenses-${randomUUID()}.db`);
  let db = database(file);
  try {
    await repo.migrate(db);
    await repo.saveExpense(db, expense());
    db.native.close();
    db = database(file);
    await repo.migrate(db);
    const r = await repo.monthlyFinances(db, "2026-11");
    assert.equal(r.entries.length, 1);
    assert.equal(r.expenses, 125050);
    assert.equal(r.net, -125050);
  } finally {
    db.native.close();
    for (const suffix of ["", "-wal", "-shm"])
      if (existsSync(file + suffix)) unlinkSync(file + suffix);
  }
});
