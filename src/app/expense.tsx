import { useCallback, useState } from "react";
import { Keyboard, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useSQLiteContext } from "../database/context";
import { getExpense, saveExpense } from "../database/repository";
import { useLoad } from "../hooks/useLedger";
import { cents, localDate, currentMonth, monthValid } from "../core/ledger";
import { expenseCategories } from "../core/finances";
import {
  Page,
  Field,
  Button,
  Card,
  Loading,
  confirm,
  s,
  colors,
  useAction,
} from "../components/ui";
export default function ExpenseScreen() {
  const params = useLocalSearchParams<{ id?: string; month?: string }>();
  const db = useSQLiteContext();
  const { busy, run } = useAction();
  const [newId] = useState(randomUUID);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() =>
    params.month && monthValid(params.month) && params.month !== currentMonth()
      ? `${params.month}-01`
      : localDate(),
  );
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const { data, error, refresh } = useLoad(
    useCallback(async () => {
      if (params.id) {
        const e = await getExpense(db, params.id);
        if (!e) throw new Error("Expense no longer exists.");
        setDescription(e.description);
        setAmount((e.amount / 100).toFixed(2));
        setDate(e.date);
        setCategory(e.category);
        setNotes(e.notes);
      }
      return true;
    }, [db, params.id]),
  );
  const save = () =>
    void run(async () => {
      await saveExpense(
        db,
        {
          id: params.id || newId,
          description,
          amount: cents(amount),
          date,
          category,
          notes,
        },
        !!params.id,
      );
      Keyboard.dismiss();
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/finances");
    });
  return (
    <Page title={params.id ? "Edit Expense" : "Add Expense"} back>
      {error ? (
        <Card>
          <Text style={s.text}>{error}</Text>
          <Button title="Retry" onPress={refresh} />
        </Card>
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <Field
            label="Description *"
            value={description}
            onChangeText={setDescription}
            maxLength={160}
            autoCapitalize="sentences"
          />
          <Field
            label="Amount (PHP) *"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            maxLength={20}
          />
          <Field
            label="Date (YYYY-MM-DD) *"
            value={date}
            onChangeText={setDate}
            maxLength={10}
          />
          <Field
            label="Category"
            value={category}
            onChangeText={setCategory}
            maxLength={80}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {expenseCategories.map((c) => (
              <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityState={{ selected: c === category }}
                onPress={() => setCategory(category === c ? "" : c)}
                style={{
                  minHeight: 44,
                  justifyContent: "center",
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  backgroundColor: category === c ? colors.green : "#E9EFE7",
                }}
              >
                <Text
                  style={{
                    color: category === c ? "#FFF" : colors.green,
                    fontWeight: "600",
                  }}
                >
                  {c}
                </Text>
              </Pressable>
            ))}
          </View>
          <Field
            label="Notes"
            value={notes}
            onChangeText={setNotes}
            maxLength={2000}
            multiline
          />
          <Button
            title={busy ? "Saving…" : "Save Expense"}
            disabled={busy}
            onPress={() =>
              params.id
                ? confirm(
                    "Save expense changes?",
                    "Monthly expenses and profit will be updated.",
                    save,
                  )
                : save()
            }
          />
        </>
      )}
    </Page>
  );
}
