/**
 * The channels of the subscription without their schemas: what a preload passes to
 * `exposeBridge`, so that its bundle never has to import Zod. A test keeps it equal to
 * `subscriptionContract`.
 */
const SUBSCRIPTION_CHANNELS = {
  invoke: {
    "subscription:get-state": true,
    "subscription:refresh": true,
    "subscription:load-plans": true,
    "subscription:purchase": true,
    "subscription:cancel-purchase": true,
    "subscription:manage": true,
  },
  events: {
    "subscription:state-changed": true,
  },
} as const;

export default SUBSCRIPTION_CHANNELS;
