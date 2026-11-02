import { useCallback, useState } from "react";
import { ScrollView, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "../database/context";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
  Button,
  Card,
  Empty,
  Loading,
  Page,
  confirm,
  s,
  useAction,
} from "../components/ui";
import {
  Receipt,
  ReceiptSnapshot,
  receiptText,
  digitalReceiptText,
} from "../core/receipts";
import { receiptAttempts, paymentReceipts } from "../database/repository";
import { useLoad } from "../hooks/useLedger";
import { usePrinter } from "../printing/PrinterProvider";
export default function ReceiptScreen() {
  const { paymentId, receiptId } = useLocalSearchParams<{
    paymentId?: string;
    receiptId?: string;
  }>();
  const db = useSQLiteContext();
  const printer = usePrinter();
  const { busy, run } = useAction();
  const [notice, setNotice] = useState("");
  const [digital, setDigital] = useState(false);
  const { data, error, refresh } = useLoad(
    useCallback(async () => {
      const rows = receiptId
        ? await db.getAllAsync<Receipt>(
            "SELECT * FROM receipts WHERE id=?",
            receiptId,
          )
        : paymentId
          ? await paymentReceipts(db, paymentId)
          : await db.getAllAsync<Receipt>(
              "SELECT * FROM receipts ORDER BY createdAt DESC,id DESC",
            );
      const receipt =
        receiptId || (paymentId && rows.length === 1) ? rows[0] : undefined;
      return {
        rows,
        receipt,
        attempts: receipt ? await receiptAttempts(db, receipt.id) : [],
      };
    }, [db, paymentId, receiptId]),
  );
  const share = (r: Receipt) =>
    void run(async () => {
      if (!(await Sharing.isAvailableAsync()))
        throw new Error(
          "File sharing is not available on this device. You can select and copy the receipt text below.",
        );
      const file = new File(Paths.document, `${r.ref}.txt`);
      if (!file.exists) file.create();
      await file.write(digitalReceiptText(r));
      await Sharing.shareAsync(file.uri, {
        mimeType: "text/plain",
        dialogTitle: "Share rental payment receipt",
      });
    });
  return (
    <Page title="Receipts" back>
      {!!notice && (
        <Card>
          <Text accessibilityLiveRegion="polite" style={s.text}>
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
      ) : data.receipt ? (
        <>
          <Card>
            <Text style={s.subtitle}>
              {digital
                ? "Digital receipt"
                : `${printer.preferences.width} mm thermal preview`}{" "}
              · Printer {printer.connection}
            </Text>
            <ScrollView horizontal accessibilityLabel="Thermal receipt preview">
              <Text
                selectable
                style={{
                  fontFamily: "monospace",
                  fontSize: 12,
                  lineHeight: 18,
                  color: "#20342E",
                }}
              >
                {digital
                  ? digitalReceiptText(data.receipt)
                  : receiptText(data.receipt, printer.preferences.width)}
              </Text>
            </ScrollView>
          </Card>
          <Button
            title={digital ? "Print Preview" : "Digital Receipt"}
            secondary
            onPress={() => setDigital((v) => !v)}
          />
          <Button
            title="Share Receipt"
            disabled={busy}
            onPress={() => share(data.receipt!)}
          />
          <Button
            title="Reprint Receipt"
            secondary
            disabled={busy || !!data.receipt.voidReason || !printer.supported}
            onPress={() =>
              confirm(
                "Print this saved receipt?",
                "Print another copy of this receipt? Check the paper first if a previous send was interrupted.",
                () =>
                  void run(async () => {
                    const result = await printer.print(data.receipt!, true);
                    setNotice(result.message);
                    refresh();
                  }),
              )
            }
          />
          <Button
            title="Printer Settings"
            secondary
            onPress={() => router.push("/bluetooth-printer")}
          />
          {data.receipt.voidReason && (
            <Text style={s.text}>Voided: {data.receipt.voidReason}</Text>
          )}
          <Text style={s.h2}>Print History</Text>
          {!data.attempts.length && (
            <Text style={s.subtitle}>
              No print attempts. Payment persistence does not depend on a
              printer.
            </Text>
          )}
          {data.attempts.map((a) => (
            <Card key={a.id}>
              <Text style={s.h2}>{a.status.toUpperCase()}</Text>
              <Text style={s.subtitle}>
                {new Date(a.createdAt).toLocaleString("en-PH")}
              </Text>
              <Text style={s.text}>{a.message}</Text>
              <Text style={s.subtitle}>Printer: {a.printer}</Text>
            </Card>
          ))}
        </>
      ) : !data.rows.length ? (
        <Empty
          title="No Receipts"
          detail="Receipts appear after recording a payment."
        />
      ) : (
        data.rows.map((r) => {
          const d: ReceiptSnapshot = JSON.parse(r.snapshot);
          return (
            <Card key={r.id}>
              <Text style={s.h2}>{d.tenantName}</Text>
              <Text selectable style={s.subtitle}>
                {r.ref}
              </Text>
              <Text style={s.subtitle}>
                {d.date} · {d.month} ·{" "}
                {r.voidReason ? "VOID / CORRECTED" : "ACTIVE"}
              </Text>
              <Button
                title="View Receipt"
                secondary
                onPress={() =>
                  router.push({
                    pathname: "/receipt",
                    params: { receiptId: r.id },
                  })
                }
              />
            </Card>
          );
        })
      )}
    </Page>
  );
}
