import { exposeBridge } from "@handijit/electron/preload";
import { withSubscriptionChannels } from "@handijit/subscription/preload";

import channels from "./channels.mjs";

// The whole preload of a program that sells subscriptions: its own channels plus the
// subscription's.
exposeBridge(withSubscriptionChannels(channels));
