import { createEmitter, registerHandlers } from "@handijit/electron/main";
import type {
  Handlers,
  RegisterHandlersOptions,
  UrlPolicy,
} from "@handijit/electron/main";

import type { SubscriptionContract, Unsubscribe } from "../types";
import subscriptionContract from "./subscription-contract";
import type { Subscription } from "./types";

/**
 * The handlers of the subscription's channels. Spread them into the program's handlers when
 * the program spread `subscriptionContract` into its contract.
 */
const createSubscriptionHandlers = (
  subscription: Subscription
): Handlers<SubscriptionContract> => ({
  "subscription:get-state": () => subscription.getState(),
  "subscription:refresh": () => subscription.refresh(),
  "subscription:load-plans": () => subscription.loadPlans(),
  "subscription:purchase": ({ interval }) => subscription.purchase(interval),
  "subscription:cancel-purchase": () => subscription.cancelPurchase(),
  "subscription:manage": () => subscription.manage(),
});

/** How `registerSubscriptionIpc` is set up. */
type RegisterSubscriptionIpcOptions = {
  /** The subscription the renderer talks to. */
  subscription: Subscription;
  /** The program's URL policy: which pages may call the handlers and receive the state. */
  policy: UrlPolicy;
  /** Receives every refused or failed call, like `registerHandlers`. Use it to log. */
  onError?: RegisterHandlersOptions["onError"];
};

/**
 * Wires the subscription to the renderer in one call: registers the handlers of
 * `subscriptionContract` and broadcasts every state change to the program's windows. Returns
 * the function that undoes both. Use it when the subscription's channels are not part of the
 * program's own contract.
 */
const registerSubscriptionIpc = ({
  subscription,
  policy,
  onError,
}: RegisterSubscriptionIpcOptions): Unsubscribe => {
  const removeHandlers = registerHandlers(
    subscriptionContract,
    createSubscriptionHandlers(subscription),
    { policy, ...(onError === undefined ? {} : { onError }) }
  );
  const emitter = createEmitter(subscriptionContract, { policy });
  const stopBroadcasting = subscription.onChange((state) => {
    emitter.broadcast("subscription:state-changed", state);
  });

  return () => {
    stopBroadcasting();
    removeHandlers();
  };
};

export type { RegisterSubscriptionIpcOptions };
export { createSubscriptionHandlers };
export default registerSubscriptionIpc;
