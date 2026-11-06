import { useCallback } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSQLiteContext } from "../database/context";
import { monthlyFinances, deleteExpense } from "../database/repository";
import { useLoad, useMonth } from "../hooks/useLedger";
import { money } from "../core/ledger";
import { screenMetrics } from "../core/layout";
import {
  Page,
  MonthPicker,
  Card,
  Button,
  Empty,
  Loading,
  confirm,
  s,
  colors,
  useAction,
} from "../components/ui";
export default function FinancesScreen() {
  const db = useSQLiteContext();
  const { month, setMonth } = useMonth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const metrics = screenMetrics(width - insets.left - insets.right);
  const { data, error, refresh } = useLoad(
    useCallback(() => monthlyFinances(db, month), [db, month]),
  );
  const { busy, run } = useAction();
  return (
    <Page title="Finances" tabbed scrollVersion={month}>
      <MonthPicker month={month} onChange={setMonth} />
      {error ? (
        <Card>
          <Text style={s.text}>{error}</Text>
          <Button title="Retry" onPress={refresh} />
        </Card>
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {[
              {
                label: "Rent Collected",
                value: data.income,
                detail: "By payment date",
              },
              {
                label: "Total Expenses",
                value: data.expenses,
                detail: "By expense date",
              },
            ].map((item) => (
              <View
                key={item.label}
                style={[s.card, { width: metrics.summaryWidth, padding: 14 }]}
              >
                <Text style={s.label}>{item.label}</Text>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={[s.amount, { fontSize: 22 }]}
                >
                  {money(item.value)}
                </Text>
                <Text style={s.label}>{item.detail}</Text>
              </View>
            ))}
          </View>
          <View
            style={[
              s.card,
              {
                backgroundColor: data.net < 0 ? "#FBECE8" : colors.ink,
                borderColor: data.net < 0 ? "#FBECE8" : colors.ink,
              },
            ]}
          >
            <Text
              style={[
                s.label,
                { color: data.net < 0 ? colors.red : "#BCD4C7" },
              ]}
            >
              {data.net < 0 ? "Net Loss" : "Net Profit"}
            </Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[
                s.amount,
                { fontSize: 32, color: data.net < 0 ? colors.red : "#FFF" },
              ]}
            >
              {money(data.net)}
            </Text>
            <Text
              style={[
                s.label,
                { color: data.net < 0 ? colors.red : "#BCD4C7" },
              ]}
            >
              Cash basis
            </Text>
          </View>
          <Button
            title="Add Expense"
            onPress={() =>
              router.push({ pathname: "/expense", params: { month } })
            }
            disabled={busy}
          />
          <Button
            title="Payment History"
            secondary
            onPress={() => router.push("/payment-history")}
          />
          {!!data.breakdown.length && (
            <Card>
              <Text style={s.h2}>Breakdown</Text>
              {data.breakdown.map((item) => (
                <View key={item.category} style={s.between}>
                  <Text style={[s.text, { flex: 1 }]}>{item.category}</Text>
                  <Text style={[s.text, { fontWeight: "700", flexShrink: 1 }]}>
                    {money(item.amount)}
                  </Text>
                </View>
              ))}
            </Card>
          )}
          <Text style={s.h2}>Expenses</Text>
          {!data.entries.length ? (
            <Empty title="No expenses this month" />
          ) : (
            data.entries.map((e) => (
              <Card key={e.id}>
                <Text style={[s.text, { fontWeight: "700" }]}>
                  {e.description}
                </Text>
                <View style={s.between}>
                  <Text style={[s.subtitle, { flex: 1 }]}>
                    {e.date}
                    {e.category ? ` · ${e.category}` : ""}
                  </Text>
                  <Text style={[s.text, { fontWeight: "700", flexShrink: 1 }]}>
                    {money(e.amount)}
                  </Text>
                </View>
                {!!e.notes && <Text style={s.subtitle}>{e.notes}</Text>}
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Edit"
                      secondary
                      disabled={busy}
                      onPress={() =>
                        router.push({
                          pathname: "/expense",
                          params: { id: e.id },
                        })
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Delete"
                      danger
                      disabled={busy}
                      onPress={() =>
                        confirm(
                          "Delete expense?",
                          `${e.description}: ${money(e.amount)} will be removed.`,
                          () =>
                            void run(async () => {
                              await deleteExpense(db, e.id);
                              refresh();
                            }),
                          true,
                        )
                      }
                    />
                  </View>
                </View>
              </Card>
            ))
          )}
        </>
      )}
    </Page>
  );
}
