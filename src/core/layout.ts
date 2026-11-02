// System insets come from safe-area-context, never guessed per device.
export const TAB_CONTENT_HEIGHT = 56;
export function tabMetrics(bottomInset: number, fontScale = 1) {
  const bottom = Math.max(0, bottomInset);
  const contentHeight = Math.max(
    TAB_CONTENT_HEIGHT,
    32 + Math.ceil(16 * fontScale),
  );
  return { height: contentHeight + bottom, paddingBottom: bottom };
}
export function screenMetrics(width: number) {
  const horizontal = width < 390 ? 16 : 20;
  return {
    horizontal,
    gap: 14,
    bottom: 16,
    summaryWidth: (width - horizontal * 2 - 10) / 2,
  };
}
export const settingsRoutes = {
  printer: "/bluetooth-printer",
  business: "/business-information",
  receipts: "/receipt",
  backup: "/backup",
  about: "/about",
} as const;
