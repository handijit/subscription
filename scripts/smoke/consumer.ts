import { createAuth } from "@handijit/auth/main";
import { defineContract, type ChannelMap } from "@handijit/electron";
import {
  createSecretStore,
  startApp,
  type AppContext,
  type Handlers,
} from "@handijit/electron/main";
import { exposeBridge } from "@handijit/electron/preload";
import {
  SUBSCRIPTION_CHANNELS,
  isSubscriptionState,
  withSubscriptionChannels,
  type PlanInterval,
  type SubscriptionState,
  type UnavailableReason,
} from "@handijit/subscription";
import {
  SubscriptionAccessError,
  createSubscription,
  createSubscriptionHandlers,
  registerSubscriptionIpc,
  subscriptionContract,
  type AccessCheck,
  type Subscription,
  type SubscriptionOptions,
} from "@handijit/subscription/main";
import { withSubscriptionChannels as forPreload } from "@handijit/subscription/preload";
import {
  useSubscription,
  type UseSubscriptionResult,
} from "@handijit/subscription/react";
import {
  createSubscriptionClient,
  subscriptionClient,
  type SubscriptionClient,
} from "@handijit/subscription/renderer";
import { z } from "zod";

// main: the auth instance of @handijit/auth and the secret store of @handijit/electron fit
// as they are.
const auth = createAuth({ product: "on-muhasebe" });
const options: SubscriptionOptions = {
  product: "on-muhasebe",
  auth,
  secretStore: createSecretStore(),
  refreshIntervalMs: 6 * 60 * 60 * 1000,
};
const subscription: Subscription = createSubscription(options);
const started: Promise<SubscriptionState> = subscription.start();
const stop: () => void = subscription.onChange((state) => {
  if (state.status === "trial") void state.trialEndsAt.toFixed(0);
  if (state.status === "subscribed") {
    const plan: PlanInterval = state.plan;
    void plan;
  }
  if (state.status === "device-mismatch") void state.boundDevice.name;
  if (state.status === "unavailable") {
    const reason: UnavailableReason = state.reason;
    void reason;
  }
});
const allowed: AccessCheck = subscription.check("records", 12);
const enforce = (): void => {
  try {
    subscription.require("records", 12);
  } catch (error) {
    if (error instanceof SubscriptionAccessError) void error.code;
  }
};

// main, the composed wiring: the fragment inside the program's own contract.
const contract = defineContract({
  invoke: {
    ...subscriptionContract.invoke,
    "notes:count": { output: z.number() },
  },
  events: { ...subscriptionContract.events },
});
type AppContract = typeof contract;
const handlers = (context: AppContext<AppContract>): Handlers<AppContract> => {
  subscription.onChange((state) => {
    context.emitter.broadcast("subscription:state-changed", state);
  });
  return {
    ...createSubscriptionHandlers(subscription),
    "notes:count": () => 0,
  };
};
const app: Promise<AppContext<AppContract> | null> = startApp({
  contract,
  handlers,
  rendererRoot: "/app/renderer",
  window: { preload: "/app/preload.cjs", width: 1100, height: 720 },
});
const unregister = (context: AppContext<AppContract>): (() => void) =>
  registerSubscriptionIpc({ subscription, policy: context.policy });

// preload
const channels: ChannelMap<AppContract> = withSubscriptionChannels({
  invoke: { "notes:count": true },
  events: {},
});
exposeBridge(channels);
exposeBridge(forPreload({ invoke: {}, events: {} }));
const names: readonly string[] = Object.keys(SUBSCRIPTION_CHANNELS.invoke);

// renderer
const client: SubscriptionClient = createSubscriptionClient();
const opened: Promise<boolean> = client.purchase("yearly");
const latest: SubscriptionState | null = subscriptionClient.getState();
const isState: boolean = isSubscriptionState(latest);

// react; the components are in consumer-ui.ts
const hook = (): UseSubscriptionResult => useSubscription(client);

// @ts-expect-error the product and the auth instance are required
const incomplete: SubscriptionOptions = { product: "on-muhasebe" };
// @ts-expect-error a status that does not exist must not compile
const impossible: SubscriptionState["status"] = "paused";
// @ts-expect-error a plan that is not sold must not compile
void client.purchase("weekly");
// @ts-expect-error a missing handler must not compile
const partial: Handlers<AppContract> = {
  ...createSubscriptionHandlers(subscription),
};
// @ts-expect-error a subpath the package does not export must not resolve
import("@handijit/subscription/main/create-subscription");

export {
  allowed,
  app,
  enforce,
  hook,
  impossible,
  incomplete,
  isState,
  names,
  opened,
  partial,
  started,
  stop,
  unregister,
};
