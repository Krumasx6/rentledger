import { useCallback, useState } from "react";
import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import { useSQLiteContext } from "../../database/context";
import { allTenants } from "../../database/repository";
import { useLoad } from "../../hooks/useLedger";
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Loading,
  Page,
  s,
} from "../../components/ui";
import { money } from "../../core/ledger";
export default function Tenants() {
  const db = useSQLiteContext();
  const { data, error, refresh } = useLoad(
    useCallback(() => allTenants(db), [db]),
  );
  const [search, setSearch] = useState("");
  return (
    <Page title="Tenants" tabbed>
      <Button title="Add Tenant" onPress={() => router.push("/tenant")} />
      <Field label="Search" value={search} onChangeText={setSearch} />
      {error ? (
        <Card>
          <Text>{error}</Text>
          <Button title="Retry" onPress={refresh} />
        </Card>
      ) : !data ? (
        <Loading />
      ) : !data.length ? (
        <Empty title="No Tenants" detail="Add your first tenant." />
      ) : (
        data
          .filter((t) =>
            `${t.name} ${t.room}`.toLowerCase().includes(search.toLowerCase()),
          )
          .map((t) => (
            <Pressable
              accessibilityRole="button"
              key={t.id}
              onPress={() =>
                router.push({ pathname: "/tenant", params: { id: t.id } })
              }
            >
              <Card>
                <Text style={[s.h2, { fontSize: 18 }]}>{t.name}</Text>
                <Text style={s.subtitle}>
                  {t.room || "No Room"} · {money(t.rent)} / month
                </Text>
                {t.endMonth && <Badge value="ARCHIVED" />}
                {t.endMonth && (
                  <Text style={s.subtitle}>
                    Final billing month: {t.endMonth}
                  </Text>
                )}
              </Card>
            </Pressable>
          ))
      )}
    </Page>
  );
}
