const { readFileSync } = require("node:fs");
const shared = require("@handijit/subscription");
const preload = require("@handijit/subscription/preload");
const react = require("@handijit/subscription/react");
const renderer = require("@handijit/subscription/renderer");
const ui = require("@handijit/subscription/ui");

const fail = (message) => {
  throw new Error(`CJS entry is broken: ${message}`);
};

if (shared.SUBSCRIPTION_CHANNELS.invoke["subscription:get-state"] !== true)
  fail("SUBSCRIPTION_CHANNELS");
if (
  preload.withSubscriptionChannels({ invoke: {}, events: {} }).events[
    "subscription:state-changed"
  ] !== true
)
  fail("preload");
if (renderer.subscriptionClient.getState() !== null) fail("renderer");
if (typeof react.useSubscription !== "function") fail("react");
if (typeof ui.SubscriptionGate !== "function") fail("ui");
if (!require.resolve("@handijit/subscription/main").endsWith("/build/main.cjs"))
  fail("main");
if (
  !readFileSync(
    require.resolve("@handijit/subscription/styles.css"),
    "utf8"
  ).includes(".hds-gate")
)
  fail("styles.css");
require("@handijit/subscription/package.json");

console.log("CJS entries OK");
