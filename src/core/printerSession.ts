// One connection operation at a time. Receipt preparation waits for an ongoing
// reconnect instead of dropping a newly saved receipt as "printer busy".
export class PrinterSession<Device> {
  private operation: Promise<unknown> | null = null;
  constructor(
    private transport: {
      supported: () => boolean;
      isConnected: () => Promise<boolean>;
      connect: (device: Device, request: boolean) => Promise<void>;
    },
    private preferences: () => { selected: Device | null; reconnect: boolean },
    private connection: (state: string) => void = () => {},
  ) {}
  get isBusy() {
    return this.operation !== null;
  }
  async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.operation) throw new Error("Printer is busy.");
    const operation = Promise.resolve().then(action);
    this.operation = operation;
    try {
      return await operation;
    } finally {
      if (this.operation === operation) this.operation = null;
    }
  }
  async prepare() {
    if (this.operation) {
      try {
        await this.operation;
      } catch {
        // Recheck the actual transport; the original operation displays its error.
      }
    }
    if (await this.transport.isConnected()) return;
    const { selected, reconnect } = this.preferences();
    if (!selected || !reconnect || !this.transport.supported()) return;
    this.connection("connecting");
    try {
      // One bounded connection attempt before any bytes are sent. Never retry a
      // failed write: some paper may already have printed.
      await this.run(() => this.transport.connect(selected, false));
      this.connection("connected");
    } catch (e) {
      this.connection("error");
      throw e;
    }
  }
}
