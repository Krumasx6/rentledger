import { router } from "expo-router";
import { Button, Page } from "../components/ui";
export default function NotFound() {
  return (
    <Page title="Page unavailable" back>
      <Button
        title="Open Settings"
        onPress={() => router.replace("/(tabs)/settings")}
      />
    </Page>
  );
}
