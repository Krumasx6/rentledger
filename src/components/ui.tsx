import {
  ComponentProps,
  ComponentRef,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TextInputProps,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { monthLabel, shiftMonth } from "../core/ledger";
import { screenMetrics } from "../core/layout";
export const colors = {
  bg: "#F8F8F3",
  ink: "#20342E",
  muted: "#69766F",
  green: "#157354",
  border: "#E1E6DE",
  amber: "#986318",
  red: "#A74941",
};
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, gap: 14, paddingBottom: 16 },
  title: {
    fontSize: 27,
    fontWeight: "800",
    color: colors.ink,
    letterSpacing: -1,
  },
  subtitle: { fontSize: 14, lineHeight: 21, color: colors.muted },
  h2: { fontSize: 20, fontWeight: "700", color: colors.ink },
  text: { fontSize: 16, color: colors.ink, lineHeight: 23 },
  card: {
    padding: 16,
    backgroundColor: "#FFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  between: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  input: {
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#D4DDD4",
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.ink,
    minHeight: 50,
  },
  button: {
    backgroundColor: colors.green,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 13,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  label: { fontSize: 13, color: colors.muted, fontWeight: "600" },
  amount: {
    fontSize: 25,
    fontWeight: "800",
    color: colors.ink,
    letterSpacing: -0.5,
  },
});
export function Page({
  children,
  title,
  subtitle,
  scrollVersion,
  tabbed = false,
  back = false,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  scrollVersion?: string;
  tabbed?: boolean;
  back?: boolean;
}) {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const { width } = useWindowDimensions();
  const metrics = screenMetrics(width);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [scrollVersion]);
  return (
    <SafeAreaView
      style={s.page}
      edges={
        tabbed || keyboardVisible
          ? ["top", "left", "right"]
          : ["top", "bottom", "left", "right"]
      }
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={
            Platform.OS === "ios" ? "interactive" : "on-drag"
          }
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustKeyboardInsets={false}
          contentContainerStyle={[
            s.body,
            { paddingHorizontal: metrics.horizontal },
          ]}
        >
          <View style={[s.row, { gap: 6 }]}>
            {back && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                onPress={() =>
                  router.canGoBack()
                    ? router.back()
                    : router.replace("/(tabs)/settings")
                }
                style={{
                  width: 44,
                  height: 48,
                  justifyContent: "center",
                  alignItems: "center",
                  marginLeft: -8,
                }}
              >
                <Feather name="chevron-left" size={26} color={colors.ink} />
              </Pressable>
            )}
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.title}>{title}</Text>
              {subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
            </View>
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Button({
  title,
  onPress,
  secondary = false,
  danger = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && { backgroundColor: "#E9EFE7" },
        danger && { backgroundColor: "#FBECE8" },
        (pressed || disabled) && { opacity: 0.55 },
      ]}
    >
      <Text
        style={[
          s.buttonText,
          secondary && { color: colors.green },
          danger && { color: colors.red },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 7 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#8A948E"
        style={[
          s.input,
          props.multiline && { minHeight: 90, textAlignVertical: "top" },
        ]}
        {...props}
      />
    </View>
  );
}
export function Card({ children }: { children: ReactNode }) {
  return <View style={s.card}>{children}</View>;
}
export function ToggleRow({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[s.between, { minHeight: 52 }]}>
      <Text style={[s.text, { flex: 1 }]}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
      />
    </View>
  );
}
export function MenuRow({
  label,
  icon,
  onPress,
  last = false,
}: {
  label: string;
  icon: ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        {
          minHeight: 56,
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: colors.border,
          opacity: pressed ? 0.55 : 1,
        },
      ]}
    >
      <Feather name={icon} size={21} color={colors.green} />
      <Text style={[s.text, { flex: 1, fontWeight: "600" }]}>{label}</Text>
      <Feather name="chevron-right" size={19} color={colors.muted} />
    </Pressable>
  );
}
export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <Card>
      <Feather name="inbox" size={30} color={colors.green} />
      <Text style={s.h2}>{title}</Text>
      {!!detail && <Text style={s.subtitle}>{detail}</Text>}
    </Card>
  );
}
export function MonthPicker({
  month,
  onChange,
}: {
  month: string;
  onChange: (m: string) => void;
}) {
  return (
    <View
      style={[
        s.between,
        { backgroundColor: "#E9EFE7", borderRadius: 16, padding: 4 },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous month"
        disabled={month === "1900-01"}
        onPress={() => onChange(shiftMonth(month, -1))}
        style={{ padding: 14 }}
      >
        <Feather name="chevron-left" size={23} color={colors.ink} />
      </Pressable>
      <Text style={[s.text, { fontWeight: "700" }]}>{monthLabel(month)}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next month"
        disabled={month === "2199-12"}
        onPress={() => onChange(shiftMonth(month, 1))}
        style={{ padding: 14 }}
      >
        <Feather name="chevron-right" size={23} color={colors.ink} />
      </Pressable>
    </View>
  );
}
export function Badge({ value }: { value: string }) {
  const color =
    value === "PAID" || value === "ACTIVE"
      ? colors.green
      : value === "PARTIAL"
        ? colors.amber
        : colors.red;
  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: color + "12",
        borderRadius: 8,
        paddingHorizontal: 9,
        paddingVertical: 5,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: "800", color }}>
        {value.charAt(0) + value.slice(1).toLowerCase()}
      </Text>
    </View>
  );
}
export function useAction() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert(
        "Could not complete action",
        e instanceof Error ? e.message : "Please try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return { busy, run };
}
export const confirm = (
  title: string,
  message: string,
  action: () => void,
  destructive = false,
) =>
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    {
      text: "Confirm",
      style: destructive ? "destructive" : "default",
      onPress: action,
    },
  ]);
export function Loading() {
  return <ActivityIndicator color={colors.green} style={{ padding: 30 }} />;
}
