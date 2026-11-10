import { vi } from "vitest";

import { VALID_STATES } from "../shared/subscription-state.fixture";

/**
 * `window.desktop` as the preload of `@handijit/electron` exposes it, with main played by the
 * test: every invoke answers with the current state, `publish` sends the event.
 */
const createFakeBridge = (initial: unknown = VALID_STATES[0]) => {
  let current = initial;
  const listeners = new Set<(payload: unknown) => void>();
  const answer = (): Promise<unknown> => Promise.resolve(current);

  const invoke = {
    "subscription:get-state": vi.fn(answer),
    "subscription:refresh": vi.fn(answer),
    "subscription:load-plans": vi.fn(answer),
    "subscription:purchase": vi.fn<(request: unknown) => Promise<boolean>>(() =>
      Promise.resolve(true)
    ),
    "subscription:cancel-purchase": vi.fn(answer),
    "subscription:manage": vi.fn(() => Promise.resolve(true)),
  };
  const on = {
    "subscription:state-changed": vi.fn(
      (listener: (payload: unknown) => void) => {
        listeners.add(listener);
        return (): void => {
          listeners.delete(listener);
        };
      }
    ),
  };
  vi.stubGlobal("desktop", { invoke, on });

  return {
    invoke,
    on,
    /** Changes what main answers, without telling the page. */
    set: (state: unknown): void => {
      current = state;
    },
    /** Changes the state and sends the event, as main does. */
    publish: (state: unknown): void => {
      current = state;
      for (const listener of [...listeners]) listener(state);
    },
    listenerCount: (): number => listeners.size,
  };
};

type FakeBridge = ReturnType<typeof createFakeBridge>;

export type { FakeBridge };
export default createFakeBridge;
