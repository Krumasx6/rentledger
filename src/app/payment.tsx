import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "../database/context";
import { randomUUID } from "expo-crypto";
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Loading,
  MonthPicker,
  Page,
  confirm,
  s,
  useAction,
} from "../components/ui";
import {
  Payment,
  cents,
  currentMonth,
  localDate,
  money,
  remaining,
  status,
} from "../core/ledger";
import { deletePayment, entries, savePayment } from "../database/repository";
import { useLoad } from "../hooks/useLedger";
import { localTime } from "../core/receipts";
import { persistThenPrint } from "../core/printing";
import { usePrinter } from "../printing/PrinterProvider";
export default function PaymentScreen() {
  const params = useLocalSearchParams<{ chargeId?: string; month?: string }>();
  const db = useSQLiteContext();
  const printer = usePrinter();
  const [method, setMethod] = useState("Cash");
  const [reference, setReference] = useState("");
  const [time, setTime] = useState(localTime);
  const [month, setMonth] = useState(params.month || currentMonth());
  const [selected, setSelected] = useState(params.chargeId || "");
  const [edit, setEdit] = useState<Payment | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(localDate());
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const { busy, run } = useAction();
  const { data, error, refresh } = useLoad(
    useCallback(
      async () => ({
        entries: await entries(db, month),
        payments: await db.getAllAsync<Payment>(
          "SELECT p.* FROM payments p JOIN charges c ON c.id=p.chargeId WHERE c.month=? ORDER BY p.date DESC,p.id DESC",
          month,
        ),
      }),
      [db, month],
    ),
  );
  const charge = data?.entries.find((e) => e.id === selected);
  const history = data?.payments.filter((p) => p.chargeId === selected) || [];

  const reset = () => {
    setEdit(null);
    setAmount("");
    setDate(localDate());
    setNote("");
    setMethod("Cash");
    setReference("");
    setTime(localTime());
  };
  const save = () =>
    void run(async () => {
      if (!charge) throw new Error("Choose a tenant.");
      const result = await persistThenPrint(
        () =>
          savePayment(
            db,
            {
              id: edit?.id || randomUUID(),
              chargeId: charge.id,
              amount: cents(amount),
              date,
              note,
              method,
              reference,
              time,
            },
            !!edit,
          ),
        (r) => printer.print(r),
        printer.preferences.autoPrint && !edit,
        () => {
          reset();
          setNotice("Payment saved.");
          refresh();
        },
      );
      setNotice(
        edit
          ? "Payment corrected. Previous receipt voided."
          : printer.preferences.autoPrint
            ? `Payment saved. ${result.print.message}`
            : "Payment saved.",
      );
    });
  return (
    <Page title="Payments" back scrollVersion={edit?.id}>
      <MonthPicker
        month={month}
        onChange={(m) => {
          setMonth(m);
          setSelected("");
          reset();
        }}
      />
      {notice && (
        <Card>
          <Text accessibilityLiveRegion="polite" style={{ color: "#157354" }}>
            {notice}
          </Text>
        </Card>
      )}
      {error ? (
        <Card>
          <Text>{error}</Text>
          <Button title="Retry" onPress={refresh} />
        </Card>
      ) : !data ? (
        <Loading />
      ) : !charge ? (
        <>
          <Field label="Search" value={search} onChangeText={setSearch} />
          {!data.entries.length ? (
            <Empty
              title="No Charges"
              detail="Choose another month or add a tenant."
            />
          ) : (
            data.entries
              .filter((c) =>
                `${c.name} ${c.room}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((c) => (
                <Card key={c.id}>
                  <Text style={s.h2}>{c.name}</Text>
                  <Text style={s.subtitle}>
                    {c.room || "No Room"} · {money(remaining(c.amount, c.paid))}{" "}
                    remaining
                  </Text>
                  <Button
                    title="Select Tenant"
                    secondary
                    onPress={() => {
                      setSelected(c.id);
                      reset();
                      setNotice("");
                    }}
                  />
                </Card>
              ))
          )}
        </>
      ) : (
        <>
          <Card>
            <Text style={s.h2}>{charge.name}</Text>
            <Text style={s.subtitle}>{charge.room || "No room assigned"}</Text>
            <Badge value={status(charge.amount, charge.paid)} />
            <Text style={s.amount}>
              {money(remaining(charge.amount, charge.paid))} remaining
            </Text>
            <Text style={s.subtitle}>
              {money(charge.paid)} paid · {money(charge.amount)} charged
            </Text>
            <Button
              title="Change Tenant"
              secondary
              disabled={busy}
              onPress={() => {
                setSelected("");
                reset();
              }}
            />
          </Card>
          {(remaining(charge.amount, charge.paid) > 0 || edit) && (
            <Card>
              <Text style={s.h2}>
                {edit ? "Edit Payment" : "Record Payment"}
              </Text>
              <Field
                label="Amount (PHP) *"
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="1000.00"
              />
              <Button
                title={`Use Balance: ${money(remaining(charge.amount, charge.paid) + (edit?.amount || 0))}`}
                secondary
                onPress={() =>
                  setAmount(
                    (
                      (remaining(charge.amount, charge.paid) +
                        (edit?.amount || 0)) /
                      100
                    ).toFixed(2),
                  )
                }
              />
              <Field
                label="Payment date (YYYY-MM-DD) *"
                value={date}
                onChangeText={setDate}
                maxLength={10}
              />
              <Field
                label="Payment time (HH:mm)"
                value={time}
                onChangeText={setTime}
                maxLength={5}
              />
              <Field
                label="Payment Method"
                value={method}
                onChangeText={setMethod}
                maxLength={60}
                placeholder="Cash, GCash, bank transfer…"
              />
              <Field
                label="Payment Reference"
                value={reference}
                onChangeText={setReference}
                maxLength={160}
              />
              <Field
                label="Note"
                value={note}
                onChangeText={setNote}
                maxLength={2000}
                multiline
              />
              <Text style={s.subtitle}>Billing month: {month}.</Text>
              <Button
                title={
                  busy ? "Saving…" : edit ? "Save Changes" : "Save Payment"
                }
                disabled={busy}
                onPress={() =>
                  edit
                    ? confirm(
                        "Save payment correction?",
                        "Monthly totals will be recalculated. The previous receipt will be voided and a new correction receipt saved.",
                        save,
                      )
                    : save()
                }
              />
              {edit && <Button title="Cancel" secondary onPress={reset} />}
            </Card>
          )}
          <Text style={s.h2}>History</Text>
          {!history.length ? (
            <Empty
              title="No Payments"
              detail="Record a full or partial payment."
            />
          ) : (
            history.map((p) => (
              <Card key={p.id}>
                <View style={s.between}>
                  <Text style={s.h2}>{money(p.amount)}</Text>
                  <Text style={s.subtitle}>{p.date}</Text>
                </View>
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
                {!!p.note && <Text style={s.subtitle}>{p.note}</Text>}
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Edit"
                      secondary
                      disabled={busy}
                      onPress={() => {
                        setEdit(p);
                        setAmount((p.amount / 100).toFixed(2));
                        setDate(p.date);
                        setNote(p.note);
                        setMethod(p.method || "Not recorded");
                        setReference(p.reference || "");
                        setTime(p.time || "");
                        setNotice(
                          "Editing payment. Review the correction form below.",
                        );
                      }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Delete"
                      danger
                      disabled={busy}
                      onPress={() =>
                        confirm(
                          "Delete this payment?",
                          `${money(p.amount)} recorded on ${p.date} will be removed. The remaining rent balance will increase.`,
                          () =>
                            void run(async () => {
                              await deletePayment(db, p.id);
                              reset();
                              setNotice("Payment deleted.");
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
