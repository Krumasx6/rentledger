import { Text } from "react-native";
import { router } from "expo-router";
import { Card, MenuRow, Page, s } from "../../components/ui";
import { settingsRoutes } from "../../core/layout";
export default function Settings() {
  return (
    <Page title="Settings" tabbed>
      <Card>
        <MenuRow
          label="Bluetooth Printer"
          icon="printer"
          onPress={() => router.push(settingsRoutes.printer)}
        />
        <MenuRow
          label="Business Information"
          icon="briefcase"
          onPress={() => router.push(settingsRoutes.business)}
        />
        <MenuRow
          label="Receipts"
          icon="file-text"
          onPress={() => router.push(settingsRoutes.receipts)}
        />
        <MenuRow
          label="Backup & Restore"
          icon="download"
          onPress={() => router.push(settingsRoutes.backup)}
        />
        <MenuRow
          label="About"
          icon="info"
          last
          onPress={() => router.push(settingsRoutes.about)}
        />
      </Card>
      <Text style={s.subtitle}>
        Back up your records before changing phones.
      </Text>
    </Page>
  );
}
