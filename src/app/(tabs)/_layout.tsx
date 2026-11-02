import { Tabs } from "expo-router";
import { useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { colors } from "../../components/ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tabMetrics } from "../../core/layout";
export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const metrics = tabMetrics(insets.bottom, fontScale);
  return (
    <Tabs
      safeAreaInsets={{
        bottom: insets.bottom,
        left: insets.left,
        right: insets.right,
        top: 0,
      }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: "#FFF",
          borderTopColor: colors.border,
          ...metrics,
        },
        tabBarItemStyle: { paddingTop: 5, paddingBottom: 3, minHeight: 48 },
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color, size }) => (
            <Feather
              name="grid"
              color={typeof color === "string" ? color : colors.muted}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="tenants"
        options={{
          title: "Tenants",
          tabBarIcon: ({ color, size }) => (
            <Feather
              name="users"
              color={typeof color === "string" ? color : colors.muted}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="records"
        options={{
          title: "Records",
          tabBarIcon: ({ color, size }) => (
            <Feather
              name="file-text"
              color={typeof color === "string" ? color : colors.muted}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Feather
              name="settings"
              color={typeof color === "string" ? color : colors.muted}
              size={size}
            />
          ),
        }}
      />
    </Tabs>
  );
}
