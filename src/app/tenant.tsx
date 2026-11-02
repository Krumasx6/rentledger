import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "../database/context";
import { randomUUID } from "expo-crypto";
import {
  Badge,
  Button,
  Card,
  Field,
  Loading,
  Page,
  confirm,
  s,
  useAction,
} from "../components/ui";
import {
  Entry,
  Tenant,
  cents,
  currentMonth,
  dueDate,
  money,
  monthLabel,
  remaining,
  shiftMonth,
  status,
} from "../core/ledger";
import { archiveTenant, entries, saveTenant } from "../database/repository";
import { useLoad, useMonth } from "../hooks/useLedger";
type History = {
  id: string;
  amount: number;
  date: string;
  note: string;
  month: string;
  chargeId: string;
};
export default function TenantScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const db = useSQLiteContext();
  const { month } = useMonth();
  const { busy, run } = useAction();
  const [editing, setEditing] = useState(!id);
  const [form, setForm] = useState<Tenant>({
    id: randomUUID(),
    name: "",
    room: "",
    rent: 0,
    dueDay: 1,
    contact: "",
    notes: "",
    startMonth: currentMonth(),
    endMonth: null,
  });
  const [rent, setRent] = useState("");
  const [due, setDue] = useState("1");
  const [end, setEnd] = useState(currentMonth());
  const load = useCallback(async () => {
    if (!id) return null;
    const tenant = await db.getFirstAsync<Tenant>(
      "SELECT * FROM tenants WHERE id=?",
      id,
    );
    if (!tenant) throw new Error("Tenant not found.");
    setForm(tenant);
    setRent((tenant.rent / 100).toFixed(2));
    setDue(String(tenant.dueDay));
    setEnd(
      tenant.endMonth ||
        (tenant.startMonth > currentMonth()
          ? tenant.startMonth
          : currentMonth()),
    );
    const monthly = (await entries(db, month)).find((e) => e.tenantId === id);
    const history = await db.getAllAsync<History>(
      "SELECT p.*,c.month FROM payments p JOIN charges c ON c.id=p.chargeId WHERE c.tenantId=? ORDER BY p.date DESC,p.id DESC",
      id,
    );
    const balances = await db.getAllAsync<Entry>(
      "SELECT c.*,COALESCE(SUM(p.amount),0) paid FROM charges c LEFT JOIN payments p ON p.chargeId=c.id WHERE c.tenantId=? GROUP BY c.id ORDER BY c.month DESC",
      id,
    );
    return { tenant, monthly, history, balances };
  }, [db, id, month]);
  const { data, error, refresh } = useLoad(load);

  const update = (key: keyof Tenant, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const save = () =>
    void run(async () => {
      const value = { ...form, rent: cents(rent), dueDay: Number(due) };
      await saveTenant(db, value, !id);
      setEditing(false);
      if (!id)
        router.replace({ pathname: "/tenant", params: { id: value.id } });
      else refresh();
    });
  return (
    <Page
      title={id ? (editing ? "Edit Tenant" : "Tenant details") : "Add Tenant"}
      back
    >
      {error ? (
        <Card>
          <Text>{error}</Text>
          <Button title="Retry" onPress={refresh} />
        </Card>
      ) : id && data === undefined ? (
        <Loading />
      ) : editing ? (
        <>
          <Field
            label="Full name *"
            value={form.name}
            maxLength={120}
            onChangeText={(v) => update("name", v)}
            autoCapitalize="words"
          />
          <Field
            label="Room / unit"
            value={form.room}
            maxLength={120}
            onChangeText={(v) => update("room", v)}
          />
          <Field
            label="Monthly rent (PHP) *"
            value={rent}
            onChangeText={setRent}
            keyboardType="decimal-pad"
            placeholder="3000.00"
          />
          <Field
            label="Payment due day (1–31) *"
            value={due}
            onChangeText={setDue}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={s.subtitle}>Short months use the last day.</Text>
          {!id && (
            <Field
              label="Rental start month (YYYY-MM) *"
              value={form.startMonth}
              onChangeText={(v) => update("startMonth", v)}
              placeholder="2026-11"
              maxLength={7}
            />
          )}
          <Field
            label="Contact number"
            value={form.contact}
            onChangeText={(v) => update("contact", v)}
            maxLength={100}
            keyboardType="phone-pad"
          />
          <Field
            label="Notes"
            value={form.notes}
            onChangeText={(v) => update("notes", v)}
            multiline
            maxLength={2000}
          />
          {id && (
            <Card>
              <Text style={s.subtitle}>
                Rent and due-day changes apply from{" "}
                {form.startMonth > currentMonth()
                  ? form.startMonth
                  : shiftMonth(currentMonth(), 1)}
                . Existing charges stay unchanged.
              </Text>
            </Card>
          )}
          <Button
            title={busy ? "Saving…" : "Save Tenant"}
            disabled={busy}
            onPress={() =>
              id
                ? confirm(
                    "Save tenant changes?",
                    "Contact details update now. Rent and due-day changes apply to newly generated future charges.",
                    save,
                  )
                : save()
            }
          />
          {id && (
            <Button
              title="Cancel"
              secondary
              onPress={() => {
                setEditing(false);
                refresh();
              }}
            />
          )}
        </>
      ) : (
        data && (
          <>
            <Card>
              <View style={s.between}>
                <Text style={[s.h2, { flex: 1 }]}>{data.tenant.name}</Text>
                <Badge value={data.tenant.endMonth ? "ARCHIVED" : "ACTIVE"} />
              </View>
              <Text style={s.subtitle}>{data.tenant.room || "No Room"}</Text>
              <Text style={s.amount}>
                {money(data.tenant.rent)}
                <Text style={s.subtitle}> / month</Text>
              </Text>
              <Text style={s.subtitle}>
                Due day {data.tenant.dueDay} · Started{" "}
                {monthLabel(data.tenant.startMonth)}
              </Text>
              {!!data.tenant.contact && (
                <Text selectable style={s.text}>
                  {data.tenant.contact}
                </Text>
              )}
              {!!data.tenant.notes && (
                <Text selectable style={s.subtitle}>
                  {data.tenant.notes}
                </Text>
              )}
              {data.tenant.endMonth && (
                <Text style={s.subtitle}>
                  Final billing month: {monthLabel(data.tenant.endMonth)}
                </Text>
              )}
            </Card>
            <Card>
              <Text style={s.h2}>{monthLabel(month)}</Text>
              {data.monthly ? (
                <>
                  <Badge
                    value={status(data.monthly.amount, data.monthly.paid)}
                  />
                  <Text style={s.subtitle}>
                    Due {dueDate(month, data.monthly.dueDay)}
                  </Text>
                  <Text style={s.amount}>
                    {money(remaining(data.monthly.amount, data.monthly.paid))}{" "}
                    remaining
                  </Text>
                  <Text style={s.subtitle}>
                    {money(data.monthly.paid)} paid of{" "}
                    {money(data.monthly.amount)}
                  </Text>
                  <Button
                    title="Payments"
                    onPress={() =>
                      router.push({
                        pathname: "/payment",
                        params: { chargeId: data.monthly!.id, month },
                      })
                    }
                  />
                </>
              ) : (
                <Text style={s.subtitle}>No charge for this month.</Text>
              )}
            </Card>
            <Text style={s.h2}>Monthly balances</Text>
            {data.balances.map((c) => (
              <Card key={c.id}>
                <View style={s.between}>
                  <Text style={s.text}>{monthLabel(c.month)}</Text>
                  <Badge value={status(c.amount, c.paid)} />
                </View>
                <Text style={s.subtitle}>Due {dueDate(c.month, c.dueDay)}</Text>
                <Text style={s.subtitle}>
                  {money(remaining(c.amount, c.paid))} remaining · Charged{" "}
                  {money(c.amount)}
                </Text>
                <Button
                  secondary
                  title="Payments"
                  onPress={() =>
                    router.push({
                      pathname: "/payment",
                      params: { chargeId: c.id, month: c.month },
                    })
                  }
                />
              </Card>
            ))}
            <Text style={s.h2}>Payment history</Text>
            {!data.history.length && (
              <Text style={s.subtitle}>No payments yet.</Text>
            )}
            {data.history.map((p) => (
              <Card key={p.id}>
                <View style={s.between}>
                  <Text style={s.text}>{money(p.amount)}</Text>
                  <Text style={s.subtitle}>{p.date}</Text>
                </View>
                <Text style={s.subtitle}>
                  Billing month: {monthLabel(p.month)}
                </Text>
                {!!p.note && <Text style={s.subtitle}>{p.note}</Text>}
                <Button
                  title="Receipt"
                  secondary
                  onPress={() =>
                    router.push({
                      pathname: "/receipt",
                      params: { paymentId: p.id },
                    })
                  }
                />
                <Button
                  title="Manage payment"
                  secondary
                  onPress={() =>
                    router.push({
                      pathname: "/payment",
                      params: { chargeId: p.chargeId, month: p.month },
                    })
                  }
                />
              </Card>
            ))}
            <Button
              title="Edit tenant"
              secondary
              onPress={() => setEditing(true)}
            />
            {!data.tenant.endMonth && (
              <Card>
                <Text style={s.h2}>Archive tenant</Text>
                <Text style={s.subtitle}>
                  History is kept. Later unpaid charges will be removed.
                </Text>
                <Field
                  label="Final billing month (YYYY-MM)"
                  value={end}
                  onChangeText={setEnd}
                  maxLength={7}
                />
                <Button
                  title={busy ? "Archiving…" : "Archive tenant"}
                  disabled={busy}
                  danger
                  onPress={() =>
                    confirm(
                      "Archive this tenant?",
                      `The final billing month will be ${end}. Existing history and receipts through that month stay available. Later unpaid charges will be removed.`,
                      () =>
                        void run(async () => {
                          await archiveTenant(db, id!, end);
                          refresh();
                        }),
                      true,
                    )
                  }
                />
              </Card>
            )}
          </>
        )
      )}
    </Page>
  );
}
