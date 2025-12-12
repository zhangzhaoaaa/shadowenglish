import { useEffect, useState } from "react";

type ToastType = "success" | "error";

type ToastOptions = {
  duration?: number;
};

type ToastItem = {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
};

// Simple in-memory toast store shared across components
let toastQueue: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

const notify = () => {
  for (const listener of listeners) listener(toastQueue);
};

const removeToast = (id: string) => {
  toastQueue = toastQueue.filter((t) => t.id !== id);
  notify();
};

const addToast = (type: ToastType, message: string, opts?: ToastOptions) => {
  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const duration = opts?.duration ?? 2000;
  const item: ToastItem = { id, type, message, duration };
  toastQueue = [...toastQueue, item];
  notify();
  window.setTimeout(() => removeToast(id), duration);
};

export const toast = {
  success: (message: string, opts?: ToastOptions) => addToast("success", message, opts),
  error: (message: string, opts?: ToastOptions) => addToast("error", message, opts)
};

export function ToastViewport() {
  const [items, setItems] = useState<ToastItem[]>(toastQueue);

  useEffect(() => {
    const listener = (next: ToastItem[]) => setItems(next);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[1000] flex flex-col gap-3 pointer-events-none px-4">
      {items.map((item) => {
        const accent = item.type === "success" ? "bg-emerald-500" : "bg-red-500";
        return (
          <div
            key={item.id}
            className="pointer-events-auto rounded-md border border-border bg-card text-foreground shadow-lg px-4 py-3 min-w-[220px] max-w-sm transition-transform duration-150"
            style={{ transform: "translateY(0)", opacity: 1 }}
          >
            <div className="flex items-start gap-3">
              <span className={`mt-1 h-2.5 w-2.5 rounded-full ${accent}`} aria-hidden />
              <div className="flex-1 text-sm leading-relaxed">{item.message}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
