import type { CollabApi, Notification } from "./collabApi.ts";

type Snapshot = { notifications: Notification[] | null; unread: number | null; loading: boolean; busy: boolean; error: string };
type Events = Pick<EventTarget, "addEventListener" | "removeEventListener">;
type Environment = {
  window: Events;
  document: Events & { visibilityState: string };
  every: (callback: () => void, milliseconds: number) => () => void;
};

export function createNotificationFeed(api: Pick<CollabApi, "notifications">) {
  let snapshot: Snapshot = { notifications: null, unread: null, loading: false, busy: false, error: "" };
  let active = false, generation = 0, lifecycle = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<Snapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); };
  const failureMessage = (failure: unknown) => failure instanceof Error ? failure.message : "Notifications could not be loaded. Please retry.";
  async function refresh() {
    if (!active || snapshot.busy) return;
    const request = ++generation;
    publish({ loading: true, error: "" });
    try {
      const result = await api.notifications();
      if (active && request === generation) publish({ ...result, loading: false });
    } catch (failure) {
      if (active && request === generation) publish({ loading: false, error: failureMessage(failure) });
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    async mutate(action: () => Promise<unknown>) {
      if (!active || snapshot.busy) return false;
      const request = ++generation;
      const started = lifecycle;
      publish({ busy: true, loading: false, error: "" });
      try {
        await action();
        if (!active || request !== generation) return false;
        publish({ busy: false });
        await refresh();
        return active && started === lifecycle;
      } catch (failure) {
        if (active && request === generation) publish({ busy: false, error: failureMessage(failure) });
        return false;
      }
    },
    start(environment: Environment) {
      active = true;
      lifecycle++;
      publish({ busy: false });
      const refreshVisible = () => { if (environment.document.visibilityState === "visible") void refresh(); };
      environment.window.addEventListener("focus", refreshVisible);
      environment.document.addEventListener("visibilitychange", refreshVisible);
      const cancel = environment.every(refreshVisible, 30_000);
      void refresh();
      return () => {
        active = false;
        lifecycle++;
        generation++;
        environment.window.removeEventListener("focus", refreshVisible);
        environment.document.removeEventListener("visibilitychange", refreshVisible);
        cancel();
      };
    },
  };
}

export type NotificationFeed = ReturnType<typeof createNotificationFeed>;
