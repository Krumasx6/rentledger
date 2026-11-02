// Kept unchanged so upgrades can be tested against the original shipped schema.
export const schemaV1 = `
CREATE TABLE tenants (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL CHECK(length(trim(name))>0), room TEXT NOT NULL, rent INTEGER NOT NULL CHECK(rent>0), dueDay INTEGER NOT NULL CHECK(dueDay BETWEEN 1 AND 28), contact TEXT NOT NULL, notes TEXT NOT NULL, startMonth TEXT NOT NULL, endMonth TEXT);
CREATE TABLE rates (id TEXT PRIMARY KEY NOT NULL, tenantId TEXT NOT NULL REFERENCES tenants(id), effectiveMonth TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), dueDay INTEGER NOT NULL CHECK(dueDay BETWEEN 1 AND 28), UNIQUE(tenantId,effectiveMonth));
CREATE TABLE charges (id TEXT PRIMARY KEY NOT NULL, tenantId TEXT NOT NULL REFERENCES tenants(id), month TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), dueDay INTEGER NOT NULL CHECK(dueDay BETWEEN 1 AND 28), UNIQUE(tenantId,month));
CREATE TABLE payments (id TEXT PRIMARY KEY NOT NULL, chargeId TEXT NOT NULL REFERENCES charges(id), amount INTEGER NOT NULL CHECK(amount>0), date TEXT NOT NULL, note TEXT NOT NULL);
CREATE INDEX payment_charge ON payments(chargeId);
CREATE INDEX charge_month ON charges(month);
CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL);
CREATE TRIGGER payment_insert_limit BEFORE INSERT ON payments BEGIN SELECT CASE WHEN NEW.amount + COALESCE((SELECT SUM(amount) FROM payments WHERE chargeId=NEW.chargeId),0) > (SELECT amount FROM charges WHERE id=NEW.chargeId) THEN RAISE(ABORT,'Payment exceeds balance') END; END;
CREATE TRIGGER payment_update_limit BEFORE UPDATE ON payments BEGIN SELECT CASE WHEN NEW.amount + COALESCE((SELECT SUM(amount) FROM payments WHERE chargeId=NEW.chargeId AND id<>NEW.id),0) > (SELECT amount FROM charges WHERE id=NEW.chargeId) THEN RAISE(ABORT,'Payment exceeds balance') END; END;
PRAGMA user_version=1;`;

export const schemaV2 = schemaV1
  .replaceAll("BETWEEN 1 AND 28", "BETWEEN 1 AND 31")
  .replace("user_version=1", "user_version=2");

// Rebuild in parent/child order with foreign keys kept ON. Temporary copies,
// schema changes, and reinsertion all live in the caller's single transaction.
export const migrateV1ToV2 = `
CREATE TEMP TABLE old_tenants AS SELECT * FROM tenants;
CREATE TEMP TABLE old_rates AS SELECT * FROM rates;
CREATE TEMP TABLE old_charges AS SELECT * FROM charges;
CREATE TEMP TABLE old_payments AS SELECT * FROM payments;
CREATE TEMP TABLE old_settings AS SELECT * FROM settings;
DROP TABLE payments;
DROP TABLE charges;
DROP TABLE rates;
DROP TABLE tenants;
DROP TABLE settings;
${schemaV2}
INSERT INTO tenants SELECT * FROM old_tenants;
INSERT INTO rates SELECT * FROM old_rates;
INSERT INTO charges SELECT * FROM old_charges;
INSERT INTO payments SELECT * FROM old_payments;
INSERT INTO settings SELECT * FROM old_settings;
DROP TABLE old_payments;
DROP TABLE old_charges;
DROP TABLE old_rates;
DROP TABLE old_tenants;
DROP TABLE old_settings;
`;

export const migrateV2ToV3 = `
ALTER TABLE payments ADD COLUMN method TEXT NOT NULL DEFAULT 'Not recorded';
ALTER TABLE payments ADD COLUMN reference TEXT NOT NULL DEFAULT '';
ALTER TABLE payments ADD COLUMN time TEXT NOT NULL DEFAULT '';
ALTER TABLE payments ADD COLUMN recordedAt TEXT NOT NULL DEFAULT '';
CREATE TABLE receipts (
 id TEXT PRIMARY KEY NOT NULL, ref TEXT NOT NULL UNIQUE,
 paymentId TEXT REFERENCES payments(id) ON DELETE SET NULL,
 revision INTEGER NOT NULL CHECK(revision>0), snapshot TEXT NOT NULL,
 voidReason TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL,
 UNIQUE(paymentId,revision)
);
CREATE UNIQUE INDEX receipt_active_payment ON receipts(paymentId) WHERE voidReason='';
CREATE TABLE print_attempts (
 id TEXT PRIMARY KEY NOT NULL, receiptId TEXT NOT NULL REFERENCES receipts(id),
 printer TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('sending','transmitted','failed','unknown','skipped')),
 message TEXT NOT NULL, createdAt TEXT NOT NULL, finishedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX receipt_sending ON print_attempts(receiptId) WHERE status='sending';
CREATE INDEX print_receipt ON print_attempts(receiptId);
PRAGMA user_version=3;
`;
export const schema = schemaV2 + migrateV2ToV3;
