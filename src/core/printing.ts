import { PaperWidth, Receipt, PrintStatus, receiptText } from "./receipts";
export type PrintResult = { status: PrintStatus; message: string };
export type PrintStore = {
  claim: (receipt: Receipt, reprint: boolean) => Promise<string | null>;
  finish: (attemptId: string, result: PrintResult) => Promise<void>;
};
export type PrinterTransport = {
  prepare?: () => Promise<void>;
  isConnected: () => Promise<boolean>;
  write: (text: string) => Promise<void>;
};
export class PrintCoordinator {
  private busy = false;
  constructor(
    private transport: PrinterTransport,
    private store: PrintStore,
    private notify: (state: string) => void = () => {},
  ) {}
  get isBusy() {
    return this.busy;
  }
  async print(
    receipt: Receipt,
    width: PaperWidth,
    reprint = false,
  ): Promise<PrintResult> {
    if (receipt.voidReason)
      return {
        status: "skipped",
        message: "Receipt voided. Open the current receipt.",
      };
    if (this.busy)
      return {
        status: "skipped",
        message: "Printer busy. Reprint from Receipts.",
      };
    this.busy = true;
    let attempt: string | null = null;
    let started = false;
    try {
      attempt = await this.store.claim(receipt, reprint);
      if (!attempt)
        return {
          status: "skipped",
          message: "Already attempted. Confirm a reprint from Receipts.",
        };
      this.notify("checking");
      await this.transport.prepare?.();
      let result: PrintResult;
      if (!(await this.transport.isConnected()))
        result = {
          status: "skipped",
          message: "Printer disconnected. Reprint from Receipts.",
        };
      else {
        const text = receiptText(receipt, width);
        this.notify("sending");
        started = true;
        await this.transport.write(text);
        result = {
          status: "transmitted",
          message: "Data sent. Check the paper.",
        };
      }
      await this.store.finish(attempt, result);
      this.notify(result.status);
      return result;
    } catch (e) {
      const result: PrintResult = {
        status: started ? "unknown" : "failed",
        message: started
          ? "Send interrupted. Check the paper before reprinting."
          : `Not sent. ${e instanceof Error ? e.message : "Check printer settings."}`,
      };
      if (attempt) {
        try {
          await this.store.finish(attempt, result);
        } catch {
          result.message += " Print history could not be updated.";
        }
      }
      this.notify(result.status);
      return result;
    } finally {
      this.busy = false;
    }
  }
}
// Persistence failure propagates without ever invoking the printer. Printer
// failure returns a saved-payment result, never another payment submission.
export async function persistThenPrint(
  save: () => Promise<Receipt>,
  print: (receipt: Receipt) => Promise<PrintResult>,
  enabled: boolean,
  onSaved: (receipt: Receipt) => void = () => {},
) {
  const receipt = await save();
  onSaved(receipt);
  if (!enabled)
    return {
      receipt,
      print: {
        status: "skipped",
        message: "Receipt saved.",
      } as PrintResult,
    };
  try {
    return { receipt, print: await print(receipt) };
  } catch {
    return {
      receipt,
      print: {
        status: "failed",
        message: "Printer unavailable. Reprint from Receipts.",
      } as PrintResult,
    };
  }
}
