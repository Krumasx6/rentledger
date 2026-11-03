import { useLocalSearchParams } from "expo-router";
import Monthly from "../screens/Monthly";

export default function PaymentStatusScreen() {
  const { status } = useLocalSearchParams<{ status?: string }>();
  const filter = status === "paid" ? "paid" : "outstanding";
  return <Monthly key={filter} records paymentFilter={filter} />;
}
