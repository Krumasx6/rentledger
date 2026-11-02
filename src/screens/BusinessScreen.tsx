import { useCallback, useState } from "react";
import { Text } from "react-native";
import { useSQLiteContext } from "../database/context";
import { Button, Loading, Page, s, useAction } from "../components/ui";
import { BusinessForm } from "../components/BusinessForm";
import { BusinessInfo, defaultBusiness } from "../core/receipts";
import { getBusiness, saveBusiness } from "../database/repository";
import { useLoad } from "../hooks/useLedger";
export default function BusinessScreen() {
  const db = useSQLiteContext();
  const { busy, run } = useAction();
  const [form, setForm] = useState<BusinessInfo>(defaultBusiness);
  const [notice, setNotice] = useState("");
  const { data, error, refresh } = useLoad(
    useCallback(async () => {
      const b = await getBusiness(db);
      setForm(b);
      return b;
    }, [db]),
  );
  const update = (key: keyof BusinessInfo, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setNotice("");
  };
  return (
    <Page title="Business Information" back>
      {error ? (
        <>
          <Text>{error}</Text>
          <Button title="Retry" onPress={refresh} />
        </>
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <BusinessForm
            value={form}
            onChange={update}
            busy={busy}
            onSave={() =>
              void run(async () => {
                await saveBusiness(db, form);
                setNotice("Business information saved.");
              })
            }
          />
          {!!notice && (
            <Text accessibilityLiveRegion="polite" style={{ color: "#157354" }}>
              {notice}
            </Text>
          )}
          <Text style={s.subtitle}>Changes apply to new receipts.</Text>
        </>
      )}
    </Page>
  );
}
