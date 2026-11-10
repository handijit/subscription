import { createClient } from "@handijit/electron/renderer";

import isSubscriptionState from "../shared/is-subscription-state";
import type {
  PlanInterval,
  SubscriptionContract,
  SubscriptionState,
  Unsubscribe,
} from "../types";

/** The page's view of the subscription: the last known state and the actions. */
type SubscriptionClient = {
  /** The last state received from main; `null` until the first one arrives. */
  readonly getState: () => SubscriptionState | null;
  /**
   * Listens to state changes. The first listener connects to main and asks for the current
   * state; the last one to leave disconnects. Returns the function that stops listening.
   */
  readonly subscribe: (
    listener: (state: SubscriptionState) => void
  ) => Unsubscribe;
  /** Asks main to renew the license now ("try again"). */
  readonly refresh: () => Promise<SubscriptionState | null>;
  /** Asks main to read the plans and their prices (again, after a failure). */
  readonly loadPlans: () => Promise<SubscriptionState | null>;
  /** Opens the subscription page for a plan in the browser; resolves with whether it opened. */
  readonly purchase: (interval: PlanInterval) => Promise<boolean>;
  /** Stops waiting for the purchase. */
  readonly cancelPurchase: () => Promise<SubscriptionState | null>;
  /** Opens the subscription page (manage, cancel, free the device); resolves with whether it opened. */
  readonly manage: () => Promise<boolean>;
};

/**
 * Creates a client over the bridge of `@handijit/electron` (`window.desktop`). The page only
 * shows what main decided: it holds no license and decides nothing. Every action rejects only
 * when the bridge is missing or main refuses the call.
 *
 * While connected it passes the window's `online` event to main as a hint to renew: Electron's
 * main process has no event of its own for a network that came back.
 *
 * A page needs one client; `subscriptionClient` is that one. Create another only for a test.
 */
const createSubscriptionClient = (): SubscriptionClient => {
  const ipc = createClient<SubscriptionContract>();
  const listeners = new Set<(state: SubscriptionState) => void>();
  let state: SubscriptionState | null = null;
  let disconnect: Unsubscribe | undefined;

  // Answers and events travel separately and may arrive out of order: the revision decides.
  // What is not a state (an older main, a broken bridge) is ignored, never trusted.
  const accept = (value: unknown): SubscriptionState | null => {
    if (
      !isSubscriptionState(value) ||
      (state !== null && value.revision <= state.revision)
    ) {
      return state;
    }
    state = value;
    for (const listener of [...listeners]) listener(value);
    return state;
  };

  const refresh = async (): Promise<SubscriptionState | null> =>
    accept(await ipc.invoke("subscription:refresh"));

  const onOnline = (): void => {
    void refresh().catch(() => undefined);
  };

  const connect = (): void => {
    let stopEvents: Unsubscribe;
    try {
      stopEvents = ipc.on("subscription:state-changed", accept);
    } catch {
      // No bridge (a browser preview, a test): the state stays `null` and the interface
      // stays quiet.
      return;
    }
    globalThis.addEventListener?.("online", onOnline);
    disconnect = () => {
      stopEvents();
      globalThis.removeEventListener?.("online", onOnline);
    };
    void ipc
      .invoke("subscription:get-state")
      .then(accept)
      .catch(() => undefined);
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      // Each subscription is its own entry, so the same function may subscribe twice.
      const entry = (next: SubscriptionState): void => {
        listener(next);
      };
      listeners.add(entry);
      if (listeners.size === 1) connect();
      return () => {
        if (!listeners.delete(entry) || listeners.size > 0) return;
        disconnect?.();
        disconnect = undefined;
      };
    },
    refresh,
    loadPlans: async () => accept(await ipc.invoke("subscription:load-plans")),
    purchase: (interval) => ipc.invoke("subscription:purchase", { interval }),
    cancelPurchase: async () =>
      accept(await ipc.invoke("subscription:cancel-purchase")),
    manage: () => ipc.invoke("subscription:manage"),
  };
};

/** The page's client. The hook and the components use it unless they are given another. */
const subscriptionClient: SubscriptionClient =
  /* @__PURE__ */ createSubscriptionClient();

export type { SubscriptionClient };
export { subscriptionClient };
export default createSubscriptionClient;
