import { subscriptionClient } from "@handijit/subscription/renderer";
import type { SubscriptionClient } from "@handijit/subscription/renderer";
import { useMemo, useSyncExternalStore } from "react";

import type { SubscriptionState } from "../types";

/** What `useSubscription` returns: the state and the actions. */
type UseSubscriptionResult = {
  /** The subscription's state; `null` until main has answered (and outside Electron). */
  readonly state: SubscriptionState | null;
  /** Asks main to renew the license now ("try again"). */
  readonly refresh: SubscriptionClient["refresh"];
  /** Asks main to read the plans again. */
  readonly loadPlans: SubscriptionClient["loadPlans"];
  /** Opens the subscription page for a plan and waits for the purchase. */
  readonly purchase: SubscriptionClient["purchase"];
  /** Stops waiting for the purchase. */
  readonly cancelPurchase: SubscriptionClient["cancelPurchase"];
  /** Opens the subscription page (manage, cancel, free the device). */
  readonly manage: SubscriptionClient["manage"];
};

// There is no subscription on a server: the first render shows nothing.
const getServerState = (): null => null;

/**
 * The subscription's state and actions for a component. Every component that uses it shares
 * one subscription to main; mounting twice (StrictMode) subscribes and unsubscribes cleanly.
 *
 * The actions reject only when the bridge is missing or main refuses the call; attach a
 * `catch` when calling them from an event handler.
 */
const useSubscription = (
  client: SubscriptionClient = subscriptionClient
): UseSubscriptionResult => {
  const state = useSyncExternalStore(
    client.subscribe,
    client.getState,
    getServerState
  );

  return useMemo(
    () => ({
      state,
      refresh: client.refresh,
      loadPlans: client.loadPlans,
      purchase: client.purchase,
      cancelPurchase: client.cancelPurchase,
      manage: client.manage,
    }),
    [state, client]
  );
};

export type { UseSubscriptionResult };
export default useSubscription;
