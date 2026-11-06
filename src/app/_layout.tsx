import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import { Component, ReactNode } from "react";
import { Text } from "react-native";
import { DatabaseProvider } from "../database/context";
import { MonthProvider } from "../hooks/useLedger";
import { PrinterProvider } from "../printing/PrinterProvider";
class Boundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <SafeAreaView
        style={{
          flex: 1,
          justifyContent: "center",
          padding: 30,
          backgroundColor: "#F8F8F3",
        }}
      >
        <Text style={{ fontSize: 22 }}>Unable to open RentLedger</Text>
        <Text>{this.state.error}</Text>
        <Text>
          Please reopen the app. Your local records have not been reset.
        </Text>
      </SafeAreaView>
    ) : (
      this.props.children
    );
  }
}
export default function Root() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <Boundary>
        <DatabaseProvider>
          <PrinterProvider>
            <MonthProvider>
              <StatusBar style="dark" />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="tenant" />
                <Stack.Screen name="payment" />
                <Stack.Screen name="payment-status" />
                <Stack.Screen name="expense" />
                <Stack.Screen name="payment-history" />
                <Stack.Screen name="about" />
                <Stack.Screen name="printer" />
                <Stack.Screen name="bluetooth-printer" />
                <Stack.Screen name="business-information" />
                <Stack.Screen name="business" />
                <Stack.Screen name="backup" />
                <Stack.Screen name="receipt" />
              </Stack>
            </MonthProvider>
          </PrinterProvider>
        </DatabaseProvider>
      </Boundary>
    </SafeAreaProvider>
  );
}
