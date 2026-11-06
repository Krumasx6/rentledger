import { Text } from "react-native";
import { useSQLiteContext } from "../database/context";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { randomUUID } from "expo-crypto";
import { useState } from "react";
import { Button, Card, Page, confirm, s, useAction } from "../components/ui";
import { exportData, restoreData } from "../database/repository";
import { Backup, validateBackup } from "../core/ledger";
import { usePrinter } from "../printing/PrinterProvider";
export default function BackupScreen() {
  const db = useSQLiteContext();
  const printer = usePrinter();
  const { busy, run } = useAction();
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Backup | null>(null);
  const exportBackup = () =>
    void run(async () => {
      if (!(await Sharing.isAvailableAsync()))
        throw new Error("File sharing is unavailable on this device.");
      const backup = await exportData(db);
      const file = new File(
        Paths.document,
        `RentLedger-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}.json`,
      );
      file.create();
      await file.write(JSON.stringify(backup, null, 2));
      // Keep the shared file: Android's receiving app may read its URI after the
      // chooser closes. Deleting it here can produce an unreadable backup.
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/json",
        dialogTitle: "Save your RentLedger backup",
        UTI: "public.json",
      });
      setNotice("Check that the backup was saved to your chosen destination.");
    });
  const pick = () =>
    void run(async () => {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "text/plain", "application/octet-stream"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const file = new File(asset.uri);
      try {
        if (file.size > 20 * 1024 * 1024)
          throw new Error(
            "Backup is too large. Maximum supported size is 20 MB.",
          );
        const b = validateBackup(JSON.parse(await file.text()));
        setPending(b);
        setNotice("Backup ready to review.");
      } finally {
        if (file.uri.startsWith(Paths.cache.uri) && file.exists) file.delete();
      }
    });
  return (
    <Page title="Backup & Restore" back>
      {!!notice && (
        <Text accessibilityLiveRegion="polite" style={s.text}>
          {notice}
        </Text>
      )}
      <Card>
        <Text style={s.subtitle}>
          Keep a copy outside this app. Uninstalling can erase your records.
        </Text>
        <Button
          title={busy ? "Please wait…" : "Export Backup"}
          disabled={busy}
          onPress={exportBackup}
        />
        <Button
          title="Import Backup"
          secondary
          disabled={busy}
          onPress={pick}
        />
      </Card>
      {pending && (
        <Card>
          <Text style={s.h2}>Restore Backup</Text>
          <Text style={s.text}>
            {pending.tenants.length} tenants · {pending.charges.length} charges
            · {pending.payments.length} payments · {pending.expenses.length}{" "}
            expenses
          </Text>
          <Text style={s.subtitle}>
            Saved {new Date(pending.exportedAt).toLocaleString("en-PH")}
          </Text>
          <Text style={s.text}>
            Replaces all records on this device. Export your current records
            first.
          </Text>
          <Button
            title="Replace Records"
            danger
            disabled={busy}
            onPress={() =>
              confirm(
                "Replace all records?",
                "This cannot be undone. Your current records will be replaced by this backup.",
                () =>
                  void run(async () => {
                    await printer.disconnect();
                    await restoreData(db, pending);
                    printer.reload();
                    setPending(null);
                    setNotice("Backup restored.");
                  }),
                true,
              )
            }
          />
          <Button
            title="Cancel"
            secondary
            disabled={busy}
            onPress={() => setPending(null)}
          />
        </Card>
      )}
    </Page>
  );
}
