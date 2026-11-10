import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as shared from "@handijit/subscription";
import * as preload from "@handijit/subscription/preload";
import * as react from "@handijit/subscription/react";
import * as renderer from "@handijit/subscription/renderer";
import * as ui from "@handijit/subscription/ui";

const fail = (message) => {
  throw new Error(`ESM entry is broken: ${message}`);
};
const resolve = (specifier) => fileURLToPath(import.meta.resolve(specifier));

// The shared entry: the channel list and the state guard.
const channels = shared.withSubscriptionChannels({
  invoke: { "notes:list": true },
  events: {},
});
if (channels.invoke["notes:list"] !== true) fail("withSubscriptionChannels");
if (channels.invoke["subscription:purchase"] !== true)
  fail("withSubscriptionChannels");
if (channels.events["subscription:state-changed"] !== true) fail("events");
if (preload.SUBSCRIPTION_CHANNELS.invoke["subscription:manage"] !== true)
  fail("preload");
if (shared.isSubscriptionState({ status: "trial" }) !== false)
  fail("isSubscriptionState");
if (!shared.SUBSCRIPTION_STATUSES.includes("device-mismatch"))
  fail("SUBSCRIPTION_STATUSES");
if (!shared.UNAVAILABLE_REASONS.includes("clock")) fail("UNAVAILABLE_REASONS");

// The renderer entry loads without a window. Without a bridge a subscriber hears nothing
// and the state stays null; an action says why it cannot work.
const client = renderer.createSubscriptionClient();
const unsubscribe = client.subscribe(() => fail("a state without a bridge"));
if (client.getState() !== null) fail("the client has a state without a bridge");
unsubscribe();
const refusal = await client.refresh().then(
  () => null,
  (cause) => String(cause)
);
if (refusal === null || !refusal.includes("window.desktop is missing")) {
  fail("refresh without a bridge");
}
if (renderer.subscriptionClient.getState() !== null) fail("subscriptionClient");

// The hook and the components build on the one client of the renderer entry.
if (typeof react.useSubscription !== "function") fail("useSubscription");
if (typeof ui.SubscriptionGate !== "function") fail("SubscriptionGate");
if (typeof ui.TrialBanner !== "function") fail("TrialBanner");
if (typeof ui.SubscriptionStatus !== "function") fail("SubscriptionStatus");
if (
  ui.DEFAULT_SUBSCRIPTION_LABELS.trialExpiredTitle !== "Deneme süreniz doldu"
) {
  fail("labels");
}

// main imports `electron`, which only an Electron process can load: here it only has to
// resolve to the right file. The Electron smoke test loads it for real.
const main = resolve("@handijit/subscription/main");
if (!main.endsWith("/build/main.mjs") || !existsSync(main)) fail("main");
const styles = resolve("@handijit/subscription/styles.css");
if (!readFileSync(styles, "utf8").includes(".hds-gate")) fail("styles.css");

console.log("ESM entries OK");
