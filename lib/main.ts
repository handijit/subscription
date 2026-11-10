// The main-process entry: the subscription, its IPC contract and the wiring for both.
export { default as createSubscription } from "./main/create-subscription";
export { default as SubscriptionAccessError } from "./main/subscription-access-error";
export {
  createSubscriptionHandlers,
  default as registerSubscriptionIpc,
} from "./main/subscription-ipc";
export { default as subscriptionContract } from "./main/subscription-contract";

export type { SubscriptionAccessCode } from "./main/subscription-access-error";
export type { RegisterSubscriptionIpcOptions } from "./main/subscription-ipc";
export type {
  AccessCheck,
  Subscription,
  SubscriptionAuth,
  SubscriptionAuthState,
  SubscriptionLogger,
  SubscriptionOptions,
  SubscriptionSecretStore,
} from "./main/types";
export type {
  PlanInterval,
  SubscriptionContract,
  SubscriptionState,
  Unsubscribe,
} from "./types";
