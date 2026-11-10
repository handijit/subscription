import type { ChannelList } from "../types";
import SUBSCRIPTION_CHANNELS from "./subscription-channels.constants";

/** The channel list of a program with the subscription's channels added. */
type WithSubscriptionChannels<C extends ChannelList> = {
  readonly invoke: C["invoke"] & typeof SUBSCRIPTION_CHANNELS.invoke;
  readonly events: C["events"] & typeof SUBSCRIPTION_CHANNELS.events;
};

/**
 * Adds the subscription's channels to the channel list of a program, for its preload:
 * `exposeBridge(withSubscriptionChannels(APP_CHANNELS))`. It composes with the helpers of the
 * other packages (`withUpdateChannels(withSubscriptionChannels(...))`). Throws when the program
 * already uses one of the names: two handlers for one channel is a bug found at start-up.
 */
const withSubscriptionChannels = <const C extends ChannelList>(
  channels: C
): WithSubscriptionChannels<C> => {
  const taken = [
    ...Object.keys(SUBSCRIPTION_CHANNELS.invoke),
    ...Object.keys(SUBSCRIPTION_CHANNELS.events),
  ].find(
    (name) =>
      Object.hasOwn(channels.invoke, name) ||
      Object.hasOwn(channels.events, name)
  );
  if (taken !== undefined) {
    throw new TypeError(
      `withSubscriptionChannels: channel "${taken}" is already in the list; the "subscription:" area belongs to @handijit/subscription`
    );
  }

  return {
    invoke: { ...channels.invoke, ...SUBSCRIPTION_CHANNELS.invoke },
    events: { ...channels.events, ...SUBSCRIPTION_CHANNELS.events },
  };
};

export type { WithSubscriptionChannels };
export default withSubscriptionChannels;
