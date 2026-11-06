// Isolated responsive previews of real shared components. No app database is
// loaded. Safe-area/keyboard sizes are simulated, not physical-device tests.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const RN = require("react-native-web");
const h = React.createElement;
const root = path.resolve(__dirname, "..");
let width = 360;
let bottom = 24;
let previewKind = "settings";
// Preview data exists only in this isolated renderer, never in app storage.
const report = {
  income: 100000,
  expenses: 125050,
  net: -25050,
  breakdown: [{ category: "Utilities", amount: 125050 }],
  entries: [
    {
      id: "preview-only",
      description: "Kuryente and water for the boarding house",
      category: "Utilities",
      amount: 125050,
      date: "2026-11-03",
      notes: "A longer expense note wraps within the card on small screens.",
      createdAt: "",
      updatedAt: "",
    },
  ],
};
const icons = require("@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Feather.json");
const cache = new Map();
function load(file) {
  let filename = path.resolve(root, file);
  if (!path.extname(filename))
    filename += fs.existsSync(filename + ".tsx") ? ".tsx" : ".ts";
  if (cache.has(filename)) return cache.get(filename);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const req = (name) => {
    if (name === "react-native")
      return {
        ...RN,
        useWindowDimensions: () => ({
          width,
          height: 760,
          scale: 1,
          fontScale: 1,
        }),
      };
    if (name === "react-native-safe-area-context")
      return {
        useSafeAreaInsets: () => ({ top: 24, bottom, left: 0, right: 0 }),
        SafeAreaView: ({ edges = [], style, children, ...props }) =>
          h(
            RN.View,
            {
              ...props,
              style: [
                style,
                {
                  paddingTop: edges.includes("top") ? 24 : 0,
                  paddingBottom: edges.includes("bottom") ? bottom : 0,
                  paddingLeft: 0,
                  paddingRight: 0,
                },
              ],
            },
            children,
          ),
      };
    if (name === "expo-router")
      return {
        router: {
          canGoBack: () => true,
          back: () => {},
          replace: () => {},
          push: () => {},
        },
        useLocalSearchParams: () => ({ month: "2026-11" }),
      };
    if (name === "expo-crypto") return { randomUUID: () => "preview-only" };
    if (name.endsWith("/database/context"))
      return { useSQLiteContext: () => ({}) };
    if (name.endsWith("/hooks/useLedger"))
      return {
        useMonth: () => ({ month: "2026-11", setMonth: () => {} }),
        useLoad: () => ({
          data:
            previewKind === "expense"
              ? true
              : previewKind === "home"
                ? {
                    entries: [
                      {
                        id: "preview-charge",
                        tenantId: "preview-tenant",
                        month: "2026-11",
                        name: "A Long Tenant Name Dela Cruz",
                        room: "Room 01",
                        dueDay: 31,
                        amount: 300000,
                        paid: 100000,
                      },
                    ],
                    finances: report,
                  }
                : report,
          error: "",
          refresh: () => {},
        }),
      };
    if (name === "@expo/vector-icons/Feather")
      return ({ name, size, color }) =>
        h(
          RN.Text,
          { style: { fontFamily: "Feather", fontSize: size, color } },
          String.fromCodePoint(icons[name] || icons.circle),
        );
    if (name.startsWith("."))
      return load(path.resolve(path.dirname(filename), name));
    return require(name);
  };
  new Function("require", "module", "exports", code)(
    req,
    module,
    module.exports,
  );
  cache.set(filename, module.exports);
  return module.exports;
}
const ui = load("src/components/ui.tsx");
const { BusinessForm } = load("src/components/BusinessForm.tsx");
const layout = load("src/core/layout.ts");
const business = {
  name: "A Long Boarding House Name",
  owner: "Maria Dela Cruz",
  address: "Tacloban City, Leyte",
  contact: "09123456789",
  footer: "Thank you for your payment!",
};
function view(kind) {
  previewKind = kind;
  if (kind === "finances")
    return h(load("src/screens/FinancesScreen.tsx").default);
  if (kind === "expense") return h(load("src/app/expense.tsx").default);
  if (kind === "home") return h(load("src/screens/Monthly.tsx").default);
  if (kind === "business")
    return h(
      ui.Page,
      { title: "Business Information", back: true },
      h(BusinessForm, {
        value: business,
        onChange: () => {},
        onSave: () => {},
      }),
    );
  if (kind === "settings")
    return h(
      ui.Page,
      { title: "Settings", tabbed: true },
      h(
        ui.Card,
        null,
        ...[
          ["Payment History", "calendar"],
          ["Bluetooth Printer", "printer"],
          ["Business Information", "briefcase"],
          ["Receipts", "file-text"],
          ["Backup & Restore", "download"],
          ["About", "info"],
        ].map(([label, icon], i) =>
          h(ui.MenuRow, {
            key: label,
            label,
            icon,
            last: i === 5,
            onPress: () => {},
          }),
        ),
      ),
      h(
        RN.Text,
        { style: ui.s.subtitle },
        "Back up your records before changing phones.",
      ),
    );
  return h(
    ui.Page,
    { title: "Payments", back: true },
    h(
      ui.Card,
      null,
      h(RN.Text, { style: ui.s.h2 }, "A Long Tenant Name Dela Cruz"),
      h(ui.Badge, { value: "PARTIAL" }),
      h(RN.Text, { style: ui.s.amount }, "₱2,000.00 remaining"),
    ),
    ...[
      "Amount (PHP)",
      "Payment Date",
      "Payment Time",
      "Payment Method",
      "Payment Reference",
      "Note",
    ].map((label) =>
      h(ui.Field, {
        key: label,
        label,
        multiline: label === "Note",
        value: "",
        onChangeText: () => {},
      }),
    ),
    h(ui.Button, { title: "Save Payment", onPress: () => {} }),
  );
}
let body = "";
for (const kind of [
  "home",
  "finances",
  "expense",
  "settings",
  "business",
  "payment",
]) {
  body += `<h2>${kind}</h2><div class="row">`;
  for (const w of [360, 390, 430]) {
    width = w;
    bottom = 24;
    const content = renderToStaticMarkup(view(kind));
    const tab = ["home", "finances", "settings"].includes(kind)
      ? `<nav style="height:${layout.tabMetrics(bottom).height}px;padding-bottom:${bottom}px">${["Home", "Tenants", "Finances", "Settings"].map((x) => `<button>${x}</button>`).join("")}</nav>`
      : "";
    body += `<section><h3>${w}px</h3><div class="phone" data-width="${w}" data-kind="${kind}" style="width:${w}px;height:760px">${content}${tab}<div class="system top">Status bar</div><div class="system bottom">Android system navigation</div></div></section>`;
  }
  body += "</div>";
}
// A reduced-height frame models available content while Android adjustResize
// owns the keyboard. It verifies scroll-to-end, not real IME behaviour.
width = 360;
bottom = 0;
body += `<h2>Reduced viewport / keyboard simulation</h2><div class="phone" data-width="360" data-kind="keyboard" style="width:360px;height:420px">${renderToStaticMarkup(view("business"))}</div>`;
const font = fs
  .readFileSync(
    path.join(
      root,
      "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Feather.ttf",
    ),
  )
  .toString("base64");
const css = RN.StyleSheet.getSheet().textContent;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}\n@font-face{font-family:Feather;src:url(data:font/ttf;base64,${font})}body{font-family:Arial;margin:24px;background:#edf0e9;color:#20342e}.row{display:flex;gap:20px;align-items:flex-start}section{flex-shrink:0}h2{margin:30px 0 6px}h3{font-size:14px} .phone{display:flex;flex-direction:column;position:relative;overflow:hidden;box-shadow:0 0 0 1px #c9d3c6;border-radius:18px;background:#f8f8f3}.system{position:absolute;left:0;right:0;height:24px;background:#e1e6de;text-align:center;line-height:24px;font-size:10px;pointer-events:none}.system.top{top:0}.system.bottom{bottom:0}nav{box-sizing:border-box;display:flex;flex-shrink:0;background:white}nav button{flex:1;border:0;background:white;color:#157354;min-height:48px;font-size:11px}</style></head><body><h1>RentLedger layout checks</h1><p>Isolated shared components · Simulated system insets · No production records</p>${body}</body></html>`;
fs.mkdirSync(path.join(root, ".expo/layout-qa"), { recursive: true });
fs.writeFileSync(path.join(root, ".expo/layout-qa/index.html"), html);
console.log(
  "Created .expo/layout-qa/index.html (360/390/430px + reduced viewport).",
);
