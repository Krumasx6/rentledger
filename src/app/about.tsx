import Constants from "expo-constants";
import { Text } from "react-native";
import { Card, Page, s } from "../components/ui";
export default function About() {
  return (
    <Page title="About" back>
      <Card>
        <Text style={s.h2}>RentLedger</Text>
        <Text style={s.subtitle}>
          Version {Constants.expoConfig?.version || "1.0.0"}
        </Text>
        <Text style={s.text}>
          Rent and payment records for your boarding house.
        </Text>
        <Text style={s.subtitle}>
          Records stay on this device. Keep a backup before changing phones.
        </Text>
      </Card>
    </Page>
  );
}
