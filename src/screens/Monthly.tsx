import { useCallback, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSQLiteContext } from "../database/context";
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Loading,
  MonthPicker,
  Page,
  colors,
  s,
} from "../components/ui";
import {
  currentMonth,
  dueDate,
  money,
  remaining,
  status,
  totals,
} from "../core/ledger";
import { screenMetrics } from "../core/layout";
import { entries } from "../database/repository";
import { useLoad, useMonth } from "../hooks/useLedger";
type PaymentFilter = "paid" | "outstanding";
export default function Monthly({
  records = false,
  paymentFilter,
}: {
  records?: boolean;
  paymentFilter?: PaymentFilter;
}) {
  const db = useSQLiteContext();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const metrics = screenMetrics(width - insets.left - insets.right);
  const { month, setMonth } = useMonth();
  const [search, setSearch] = useState("");
  const { data, error, refresh } = useLoad(
    useCallback(() => entries(db, month), [db, month]),
  );
  const total = totals(data || []);
  const matchingStatus = data?.filter((e) =>
    paymentFilter === "paid"
      ? status(e.amount, e.paid) === "PAID"
      : paymentFilter === "outstanding"
        ? status(e.amount, e.paid) !== "PAID"
        : true,
  );
  const filtered = matchingStatus?.filter((e) =>
    `${e.name} ${e.room}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Page
      tabbed={!paymentFilter}
      back={!!paymentFilter}
      title={
        paymentFilter === "paid"
          ? "Fully Paid"
          : paymentFilter === "outstanding"
            ? "Unpaid / Partial"
            : records
              ? "Records"
              : "RentLedger"
      }
    >
      <MonthPicker month={month} onChange={setMonth} />
      {month !== currentMonth() && (
        <Button
          title="This Month"
          secondary
          onPress={() => setMonth(currentMonth())}
        />
      )}
      {error ? (
        <Card>
          <Text style={s.text}>{error}</Text>
          <Button title="Try again" onPress={refresh} />
        </Card>
      ) : !data ? (
        <Loading />
      ) : (
        <>
          {!paymentFilter && (
            <>
              <View
                style={[
                  s.card,
                  {
                    backgroundColor: colors.ink,
                    borderColor: colors.ink,
                    padding: 20,
                  },
                ]}
              >
                <Text
                  style={{ color: "#BCD4C7", fontSize: 13, fontWeight: "600" }}
                >
                  Collected
                </Text>
                <Text
                  adjustsFontSizeToFit
                  numberOfLines={1}
                  style={{
                    color: "#FFF",
                    fontSize: 34,
                    fontWeight: "800",
                    letterSpacing: -1,
                  }}
                >
                  {money(total.collected)}
                </Text>
                <View style={s.between}>
                  <Text style={{ color: "#BCD4C7" }}>Progress</Text>
                  <Text style={{ color: "#FFF", fontWeight: "700" }}>
                    {Math.round(total.progress * 100)}%
                  </Text>
                </View>
                <View
                  accessibilityLabel={`Collection progress ${Math.round(total.progress * 100)} percent`}
                  style={{
                    height: 7,
                    backgroundColor: "#486057",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      height: 7,
                      width: `${total.progress * 100}%`,
                      backgroundColor: "#8CD9B2",
                    }}
                  />
                </View>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {[
                  { label: "Remaining", value: money(total.remaining) },
                  { label: "Expected", value: money(total.expected) },
                  {
                    label: "Fully Paid",
                    value: String(total.paid),
                    filter: "paid",
                  },
                  {
                    label: "Unpaid / Partial",
                    value: String(total.outstanding),
                    filter: "outstanding",
                  },
                ].map(({ label, value, filter }) => {
                  const content = (
                    <>
                      <Text style={s.label}>{label}</Text>
                      <Text
                        adjustsFontSizeToFit
                        numberOfLines={1}
                        style={[s.amount, { fontSize: 21 }]}
                      >
                        {value}
                      </Text>
                    </>
                  );
                  const style = [
                    s.card,
                    { width: metrics.summaryWidth, padding: 14 },
                  ];
                  return filter ? (
                    <Pressable
                      key={label}
                      style={style}
                      accessibilityRole="button"
                      accessibilityLabel={`${label}, ${value} tenants`}
                      accessibilityHint="Opens the matching list for this billing month"
                      onPress={() =>
                        router.push({
                          pathname: "/payment-status",
                          params: { status: filter },
                        })
                      }
                    >
                      {content}
                    </Pressable>
                  ) : (
                    <View key={label} style={style}>
                      {content}
                    </View>
                  );
                })}
              </View>
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Add Tenant"
                    secondary
                    onPress={() => router.push("/tenant")}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Record Payment"
                    onPress={() =>
                      router.push({ pathname: "/payment", params: { month } })
                    }
                  />
                </View>
              </View>
            </>
          )}
          <View style={{ gap: 12 }}>
            <Text style={s.h2}>Tenants</Text>
            <Field
              label="Search"
              placeholder="Name or room…"
              value={search}
              onChangeText={setSearch}
            />
            {!matchingStatus?.length ? (
              <Empty
                title={
                  paymentFilter === "paid"
                    ? "No fully paid tenants"
                    : paymentFilter === "outstanding"
                      ? "No unpaid or partial balances"
                      : "No Charges"
                }
                detail={
                  paymentFilter
                    ? "For this billing month."
                    : "Add a tenant or choose another month."
                }
              />
            ) : !filtered?.length ? (
              <Empty
                title="No matches"
                detail="Try a different name or room."
              />
            ) : (
              filtered.map((e) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${e.name}, ${status(e.amount, e.paid)}, ${money(remaining(e.amount, e.paid))} remaining`}
                  key={e.id}
                  onPress={() =>
                    router.push({
                      pathname: "/tenant",
                      params: { id: e.tenantId },
                    })
                  }
                >
                  <Card>
                    <View style={s.between}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={[s.text, { fontWeight: "700" }]}>
                          {e.name}
                        </Text>
                        <Text style={s.subtitle}>
                          {e.room || "No room"} · Due{" "}
                          {dueDate(e.month, e.dueDay)}
                        </Text>
                      </View>
                      <Badge value={status(e.amount, e.paid)} />
                    </View>
                    <View style={s.between}>
                      <Text style={[s.subtitle, { flex: 1 }]}>
                        {money(e.paid)} of {money(e.amount)}
                      </Text>
                      <Text
                        style={{
                          fontWeight: "700",
                          color: colors.ink,
                          flexShrink: 1,
                          textAlign: "right",
                        }}
                      >
                        {money(remaining(e.amount, e.paid))} left
                      </Text>
                    </View>
                    {records && (
                      <Button
                        title={
                          e.paid === e.amount
                            ? "View payments"
                            : "Record Payment"
                        }
                        secondary
                        onPress={() =>
                          router.push({
                            pathname: "/payment",
                            params: { chargeId: e.id, month },
                          })
                        }
                      />
                    )}
                  </Card>
                </Pressable>
              ))
            )}
          </View>
        </>
      )}
    </Page>
  );
}
