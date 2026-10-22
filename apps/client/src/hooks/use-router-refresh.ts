import { useEffect, useRef } from "react";
import { useFetchers, useNavigation, useRevalidator } from "react-router";
export function useRouterRefresh(poll = false) {
  const revalidator = useRevalidator(),
    navigation = useNavigation(),
    fetchers = useFetchers();
  const busy =
    navigation.state !== "idle" || fetchers.some((f) => f.state !== "idle");
  const inFlight = useRef(false);
  const { state, revalidate } = revalidator;
  useEffect(() => {
    const refresh = () => {
      if (
        !busy &&
        !inFlight.current &&
        state === "idle" &&
        document.visibilityState === "visible"
      ) {
        inFlight.current = true;
        void revalidate().finally(() => {
          inFlight.current = false;
        });
      }
    };
    window.addEventListener("focus", refresh);
    const timer = poll ? window.setInterval(refresh, 15_000) : undefined;
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [busy, state, revalidate, poll]);
}
