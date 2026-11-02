import { ReactNode } from "react";
import { requireOptionalNativeModule } from "expo";
import type { SQLiteDatabase } from "expo-sqlite";
import { Text } from "react-native";
import { Card, Page, s } from "../components/ui";
import { migrate } from "./repository";
type SQLite = typeof import("expo-sqlite");
function sqlite(): SQLite | null {
  if (!requireOptionalNativeModule("ExpoSQLite")) return null;
  // Missing native modules must not invalidate route exports during import.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Guarded native module loading.
  return require("expo-sqlite") as SQLite;
}
export function DatabaseProvider({ children }: { children: ReactNode }) {
  const module = sqlite();
  if (!module)
    return (
      <Page title="App update required">
        <Card>
          <Text style={s.text}>
            Database support is missing from this installation. Open the latest
            RentLedger testing build.
          </Text>
          <Text style={s.subtitle}>
            Your saved records have not been reset.
          </Text>
        </Card>
      </Page>
    );
  const Provider = module.SQLiteProvider;
  return (
    <Provider databaseName="rentledger.db" onInit={migrate}>
      {children}
    </Provider>
  );
}
export function useSQLiteContext(): SQLiteDatabase {
  const module = sqlite();
  if (!module)
    throw new Error(
      "Database support is missing. Open the latest RentLedger testing build.",
    );
  return module.useSQLiteContext();
}
