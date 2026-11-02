import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import { useFocusEffect } from "expo-router";
import { currentMonth } from "../core/ledger";
const Context = createContext({
  month: currentMonth(),
  setMonth: (_m: string) => {},
});
export function MonthProvider({ children }: { children: ReactNode }) {
  const [month, setMonth] = useState(currentMonth);
  return (
    <Context.Provider value={{ month, setMonth }}>{children}</Context.Provider>
  );
}
export const useMonth = () => useContext(Context);
export function useLoad<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((n) => n + 1);
  useFocusEffect(
    useCallback(() => {
      void revision;
      let alive = true;
      setData(undefined);
      setError("");
      loader()
        .then((value) => {
          if (alive) setData(value);
        })
        .catch((e) => {
          if (alive) setError(String(e.message || e));
        });
      return () => {
        alive = false;
      };
    }, [loader, revision]),
  );
  return { data, error, refresh };
}
