import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { useSQLiteContext } from "../database/context";
import { bluetooth, Device } from "./bluetooth";
import { PaperWidth, Receipt, receiptText, localTime } from "../core/receipts";
import { localDate } from "../core/ledger";
import { PrintCoordinator, PrintResult } from "../core/printing";
import { PrinterSession } from "../core/printerSession";
import {
  claimPrint,
  finishPrint,
  getBusiness,
  getSetting,
  setSetting,
} from "../database/repository";
export type PrinterPreferences = {
  selected: Device | null;
  width: PaperWidth;
  autoPrint: boolean;
  reconnect: boolean;
};
const defaults: PrinterPreferences = {
  selected: null,
  width: 58,
  autoPrint: false,
  reconnect: true,
};
function validPreferences(value: PrinterPreferences): PrinterPreferences {
  const d = value?.selected;
  const selected =
    d &&
    typeof d.id === "string" &&
    d.id.length <= 200 &&
    typeof d.name === "string" &&
    d.name.length <= 200 &&
    typeof d.address === "string" &&
    ["ble", "bluetooth-classic"].includes(d.transport)
      ? d
      : null;
  return {
    selected,
    width: value?.width === 80 ? 80 : 58,
    autoPrint: value?.autoPrint === true,
    reconnect: value?.reconnect !== false,
  };
}
class PrinterEngine {
  private preferences = defaults;
  readonly coordinator: PrintCoordinator;
  readonly session: PrinterSession<Device>;
  constructor(
    db: Parameters<typeof claimPrint>[0],
    notify: (state: string) => void,
    connection: (state: string) => void,
  ) {
    this.session = new PrinterSession(
      bluetooth,
      () => this.preferences,
      connection,
    );
    this.coordinator = new PrintCoordinator(
      {
        prepare: () => this.session.prepare(),
        isConnected: () => bluetooth.isConnected(),
        write: (text) => bluetooth.write(text),
      },
      {
        claim: (r, reprint) =>
          claimPrint(
            db,
            r,
            this.preferences.selected?.id || "No printer",
            reprint,
          ),
        finish: (id, result) => finishPrint(db, id, result),
      },
      notify,
    );
  }
  getPreferences() {
    return this.preferences;
  }
  setPreferences(value: PrinterPreferences) {
    this.preferences = value;
  }
}
function usePrinterController() {
  const db = useSQLiteContext();
  const [preferences, setPreferences] = useState(defaults);
  const [connection, setConnection] = useState("disconnected");
  const [printState, setPrintState] = useState("idle");
  const [message, setMessage] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const nextRetry = useRef(0);
  const engine = useMemo(
    () => new PrinterEngine(db, setPrintState, setConnection),
    [db],
  );
  const session = engine.session;
  const coordinator = engine.coordinator;
  const update = useCallback(
    async (patch: Partial<PrinterPreferences>) => {
      const next = validPreferences({ ...engine.getPreferences(), ...patch });
      await setSetting(db, "printer", next);
      engine.setPreferences(next);
      setPreferences(next);
    },
    [db, engine],
  );
  const reload = useCallback(() => setRevision((n) => n + 1), [setRevision]);
  useEffect(() => {
    let alive = true;
    getSetting(db, "printer", defaults)
      .then((value) => {
        if (alive) {
          const p = validPreferences(value);
          engine.setPreferences(p);
          setPreferences(p);
          setReady(true);
        }
      })
      .catch(() => {
        if (alive) {
          setReady(true);
          setMessage("Printer settings could not be loaded.");
        }
      });
    return () => {
      alive = false;
    };
  }, [db, revision, engine]);
  const connect = useCallback(
    async (device: Device, request = true) => {
      if (session.isBusy || coordinator.isBusy)
        throw new Error("Printer is busy. Wait for the current operation.");
      return session.run(async () => {
        setConnection("connecting");
        try {
          await bluetooth.connect(device, request);
          await update({ selected: device, reconnect: true });
          setConnection("connected");
          setMessage("Connected.");
        } catch (e) {
          setConnection("error");
          setMessage(
            e instanceof Error ? e.message : "Could not connect printer.",
          );
          throw e;
        } finally {
          nextRetry.current = Date.now() + 30000;
        }
      });
    },
    [coordinator, session, update],
  );
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    let checking = false;
    const tick = async () => {
      if (
        checking ||
        session.isBusy ||
        coordinator.isBusy ||
        AppState.currentState !== "active"
      )
        return;
      checking = true;
      try {
        const connected = await bluetooth.isConnected();
        if (!alive) return;
        setConnection(connected ? "connected" : "disconnected");
        const p = engine.getPreferences();
        if (
          !connected &&
          p.selected &&
          p.reconnect &&
          bluetooth.supported() &&
          Date.now() >= nextRetry.current
        ) {
          nextRetry.current = Date.now() + 30000;
          try {
            await connect(p.selected, false);
          } catch {
            /* Failure remains visible; retry is bounded and never replays receipts. */
          }
        }
      } finally {
        checking = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 4000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void tick();
    });
    return () => {
      alive = false;
      clearInterval(timer);
      sub.remove();
    };
  }, [ready, coordinator, connect, engine, session]);
  const discover = async () => {
    if (session.isBusy || coordinator.isBusy)
      throw new Error("Printer is busy.");
    return session.run(async () => {
      setConnection("discovering");
      try {
        const found = await bluetooth.discover();
        setDevices(found);
        setMessage(
          found.length
            ? "Select your receipt printer."
            : "No printers found. Check power and Bluetooth.",
        );
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Discovery failed.");
        throw e;
      } finally {
        setConnection(
          (await bluetooth.isConnected()) ? "connected" : "disconnected",
        );
      }
    });
  };
  const disconnect = async () => {
    if (session.isBusy || coordinator.isBusy)
      throw new Error("Wait until sending finishes before disconnecting.");
    return session.run(async () => {
      await update({ reconnect: false });
      await bluetooth.disconnect();
      setConnection("disconnected");
      setMessage("Auto-reconnect paused.");
    });
  };
  const print = async (r: Receipt, reprint = false): Promise<PrintResult> => {
    const result = await coordinator.print(
      r,
      engine.getPreferences().width,
      reprint,
    );
    setMessage(result.message);
    setConnection(
      (await bluetooth.isConnected()) ? "connected" : "disconnected",
    );
    return result;
  };
  const test = async () => {
    if (session.isBusy || coordinator.isBusy)
      throw new Error("Printer is busy.");
    return session.run(async () => {
      setPrintState("sending");
      try {
        if (!(await bluetooth.isConnected()))
          throw new Error("Connect a supported printer first.");
        const snapshot = {
          business: await getBusiness(db),
          tenantName: "TEST - NOT A PAYMENT",
          room: "TEST",
          month: localDate().slice(0, 7),
          charge: 300000,
          amount: 100000,
          remaining: 200000,
          date: localDate(),
          time: localTime(),
          recordedAt: "",
          method: "Test only",
          reference: "",
          legacy: false,
        };
        await bluetooth.write(
          receiptText(
            {
              id: "test",
              ref: "TEST-NO-TRANSACTION",
              paymentId: null,
              revision: 1,
              snapshot: JSON.stringify(snapshot),
              voidReason: "",
              createdAt: "",
            },
            engine.getPreferences().width,
          ),
        );
        setPrintState("transmitted");
        setMessage("Test data sent. Check the paper.");
      } catch (e) {
        setPrintState("unknown");
        setMessage("Test send interrupted. Check paper before retrying.");
        throw e;
      }
    });
  };
  return {
    preferences,
    ready,
    connection,
    printState,
    message,
    devices,
    supported: bluetooth.supported(),
    update,
    connect,
    discover,
    disconnect,
    print,
    test,
    reload,
  };
}
type Controller = ReturnType<typeof usePrinterController>;
const Context = createContext<Controller | null>(null);
export function PrinterProvider({ children }: { children: ReactNode }) {
  const value = usePrinterController();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function usePrinter() {
  const value = useContext(Context);
  if (!value) throw new Error("Printer provider is unavailable.");
  return value;
}
