import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import type { ActionResult } from "@/routes/shared";

// Fetcher submissions share pending/error handling without a client-side data cache.
export function useRouteMutation<T, V = void>(
  action: string,
  fields: (value: V) => FormData | Record<string, string | string[]>,
  onSuccess?: (data: T, value: V) => void,
  onResult?: (result: ActionResult<T>, value: V) => void,
) {
  const fetcher = useFetcher<ActionResult<T>>();
  const pending = useRef(false),
    variables = useRef<V>(undefined),
    handled = useRef(fetcher.data);
  const callback = useRef(onSuccess),
    resultCallback = useRef(onResult);
  useEffect(() => {
    callback.current = onSuccess;
    resultCallback.current = onResult;
  });
  useEffect(() => {
    if (fetcher.state !== "idle") return;
    pending.current = false;
    if (fetcher.data && fetcher.data !== handled.current) {
      handled.current = fetcher.data;
      resultCallback.current?.(fetcher.data, variables.current as V);
      if (fetcher.data.ok)
        callback.current?.(fetcher.data.value, variables.current as V);
    }
  }, [fetcher.state, fetcher.data]);
  return {
    isPending: fetcher.state !== "idle",
    error: fetcher.data?.ok === false ? fetcher.data.error : undefined,
    mutate(value: V) {
      if (pending.current) return;
      pending.current = true;
      variables.current = value;
      const fieldsToSubmit = fields(value);
      const body =
        fieldsToSubmit instanceof FormData ? fieldsToSubmit : new FormData();
      if (!(fieldsToSubmit instanceof FormData)) {
        for (const [key, entry] of Object.entries(fieldsToSubmit)) {
          for (const item of Array.isArray(entry) ? entry : [entry])
            body.append(key, item);
        }
      }
      void fetcher.submit(body, {
        action,
        method: "post",
        encType:
          fieldsToSubmit instanceof FormData
            ? "multipart/form-data"
            : "application/x-www-form-urlencoded",
      });
    },
  };
}
export function useDialogLoader<T>(href: string | null) {
  const fetcher = useFetcher<ActionResult<T>>();
  const { load } = fetcher;
  useEffect(() => {
    if (href) void load(href);
  }, [href, load]);
  return {
    data: fetcher.data?.ok ? fetcher.data.value : undefined,
    error: fetcher.data?.ok === false ? fetcher.data.error : undefined,
    isPending: Boolean(href) && (!fetcher.data || fetcher.state !== "idle"),
    refetch: () => (href ? load(href) : Promise.resolve()),
  };
}
