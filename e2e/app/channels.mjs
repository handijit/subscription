import { AUTH_CHANNELS } from "@handijit/auth/preload";

// The fixture program's own channels without their schemas: the sign-in of @handijit/auth and
// one channel of its own. The preload adds the subscription's with withSubscriptionChannels.
export default {
  invoke: { ...AUTH_CHANNELS.invoke, "app:info": true },
  events: { ...AUTH_CHANNELS.events },
};
