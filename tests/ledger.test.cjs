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
  assert.equal((await db.getFirstAsync("PRAGMA user_version")).user_version, 3);
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
  assert.equal(backup.schemaVersion, 3);
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
  assert.equal((await db.getFirstAsync("PRAGMA user_version")).user_version, 3);
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

test("version-1 JSON backups remain importable by version 3", async (t) => {
  const db = await setup(t);
  const restored = await setup(t);
  const person = tenant();
  await repo.saveTenant(db, person, true);
  await repo.entries(db, person.startMonth);
  const old = { ...(await repo.exportData(db)), schemaVersion: 1 };
  assert.equal(core.validateBackup(old).schemaVersion, 3);
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
