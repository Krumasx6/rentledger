import { BusinessInfo } from "../core/receipts";
import { Button, Field } from "./ui";
export function BusinessForm({
  value,
  onChange,
  onSave,
  busy = false,
}: {
  value: BusinessInfo;
  onChange: (key: keyof BusinessInfo, text: string) => void;
  onSave: () => void;
  busy?: boolean;
}) {
  return (
    <>
      <Field
        label="Boarding House / Business Name"
        value={value.name}
        maxLength={120}
        onChangeText={(v) => onChange("name", v)}
        autoCapitalize="words"
      />
      <Field
        label="Owner / Manager"
        value={value.owner || ""}
        maxLength={120}
        onChangeText={(v) => onChange("owner", v)}
        autoCapitalize="words"
      />
      <Field
        label="Address"
        value={value.address}
        maxLength={300}
        multiline
        onChangeText={(v) => onChange("address", v)}
      />
      <Field
        label="Contact Number"
        value={value.contact}
        maxLength={100}
        keyboardType="phone-pad"
        onChangeText={(v) => onChange("contact", v)}
      />
      <Field
        label="Receipt Footer"
        value={value.footer}
        maxLength={300}
        multiline
        onChangeText={(v) => onChange("footer", v)}
      />
      <Button
        title={busy ? "Saving…" : "Save"}
        disabled={busy}
        onPress={onSave}
      />
    </>
  );
}
