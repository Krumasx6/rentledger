const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const moduleObject = { exports: {} };
new Function(
  "module",
  "exports",
  ts.transpileModule(
    fs.readFileSync(path.join(root, "src/core/layout.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
)(moduleObject, moduleObject.exports);
const { settingsRoutes, tabMetrics, screenMetrics, TAB_CONTENT_HEIGHT } =
  moduleObject.exports;
test("all Settings destinations exist, export screens, and are registered in the root stack", () => {
  const rootFile = ts.createSourceFile(
    "root.tsx",
    fs.readFileSync(path.join(root, "src/app/_layout.tsx"), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const screens = new Set();
  function visit(n) {
    if (
      ts.isJsxSelfClosingElement(n) &&
      n.tagName.getText(rootFile) === "Stack.Screen"
    ) {
      const name = n.attributes.properties.find(
        (x) => x.name?.getText(rootFile) === "name",
      );
      if (name?.initializer && ts.isStringLiteral(name.initializer))
        screens.add(name.initializer.text);
    }
    ts.forEachChild(n, visit);
  }
  visit(rootFile);
  for (const route of Object.values(settingsRoutes)) {
    const name = route.slice(1);
    const file = path.join(root, "src/app", name + ".tsx");
    assert.ok(fs.existsSync(file), route);
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    assert.ok(
      source.statements.some(
        (n) =>
          (ts.isExportDeclaration(n) &&
            n.exportClause?.getText(source).includes("default")) ||
          n.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword),
      ),
      route + " default export",
    );
    assert.ok(screens.has(name), route + " registration");
  }
});
test("legacy printer and business links redirect to canonical settings screens", () => {
  for (const [name, to] of [
    ["printer", settingsRoutes.printer],
    ["business", settingsRoutes.business],
  ]) {
    const text = fs.readFileSync(
      path.join(root, "src/app", name + ".tsx"),
      "utf8",
    );
    assert.ok(text.includes("Redirect"));
    assert.ok(text.includes(to));
  }
});

test("main navigation has four visible tabs and retains access to old records", () => {
  const filename = path.join(root, "src/app/(tabs)/_layout.tsx");
  const source = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const visible = [];
  function visit(n) {
    if (
      ts.isJsxSelfClosingElement(n) &&
      n.tagName.getText(source) === "Tabs.Screen"
    ) {
      const attributes = n.attributes.properties;
      const name = attributes.find((x) => x.name?.getText(source) === "name")
        ?.initializer?.text;
      const options = attributes.find(
        (x) => x.name?.getText(source) === "options",
      )?.initializer?.expression;
      const hidden =
        options &&
        ts.isObjectLiteralExpression(options) &&
        options.properties.some(
          (x) =>
            x.name?.getText(source) === "href" &&
            x.initializer?.kind === ts.SyntaxKind.NullKeyword,
        );
      if (!hidden) visible.push(name);
    }
    ts.forEachChild(n, visit);
  }
  visit(source);
  assert.deepEqual(visible, ["index", "tenants", "finances", "settings"]);
  assert.ok(fs.existsSync(path.join(root, "src/app/expense.tsx")));
  const oldRecords = fs.readFileSync(
    path.join(root, "src/app/(tabs)/records.tsx"),
    "utf8",
  );
  assert.ok(oldRecords.includes('href="/payment-history"'));
});
test("tab bar leaves measured gesture and three-button navigation insets below touch targets", () => {
  for (const bottom of [0, 16, 24, 34, 48]) {
    const m = tabMetrics(bottom);
    assert.equal(m.height - m.paddingBottom, TAB_CONTENT_HEIGHT);
    assert.ok(m.height - m.paddingBottom >= 48);
    assert.equal(m.paddingBottom, bottom);
  }
  assert.equal(tabMetrics(-1).paddingBottom, 0);
  for (const fontScale of [1.3, 1.5, 2]) {
    const m = tabMetrics(24, fontScale);
    assert.ok(m.height - m.paddingBottom >= 32 + Math.ceil(16 * fontScale));
    assert.equal(m.paddingBottom, 24);
  }
  for (const width of [360, 390, 430]) {
    const m = screenMetrics(width);
    assert.ok(m.summaryWidth >= 150);
    assert.equal(m.summaryWidth * 2 + 10 + 2 * m.horizontal, width);
    assert.ok(m.bottom >= 12);
  }
});
test("route modules do not eagerly import SQLite native code before the root can handle a missing client module", () => {
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (f.endsWith(".tsx")) {
        const source = ts.createSourceFile(
          f,
          fs.readFileSync(f, "utf8"),
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        );
        for (const n of source.statements)
          if (
            ts.isImportDeclaration(n) &&
            n.moduleSpecifier.text === "expo-sqlite"
          )
            assert.ok(n.importClause?.isTypeOnly, f);
      }
    }
  }
  walk(path.join(root, "src/app"));
  walk(path.join(root, "src/screens"));
});
