import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";

import useSubscription from "../../lib/react/use-subscription";
import createSubscriptionClient, {
  subscriptionClient,
} from "../../lib/renderer/create-subscription-client";
import type { SubscriptionState } from "../../lib/types";
import createFakeBridge from "../renderer/bridge.fixture";
import { VALID_STATES } from "../shared/subscription-state.fixture";

const [, TRIAL] = VALID_STATES as [SubscriptionState, SubscriptionState];

describe("useSubscription", () => {
  test("should give the state and the actions of the client", async () => {
    const bridge = createFakeBridge(TRIAL);
    const client = createSubscriptionClient();
    const { result } = renderHook(() => useSubscription(client), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <StrictMode>{children}</StrictMode>
      ),
    });
    await waitFor(() => {
      expect(result.current.state).toEqual(TRIAL);
    });
    expect(result.current.purchase).toBe(client.purchase);
    expect(result.current.manage).toBe(client.manage);
    act(() => {
      bridge.publish({ ...TRIAL, revision: 9 });
    });
    expect(result.current.state?.revision).toBe(9);
    expect(bridge.listenerCount()).toBe(1);
  });

  test("should render nothing on a server", () => {
    createFakeBridge(TRIAL);
    const client = createSubscriptionClient();
    const Probe = (): ReactElement => (
      <span>{useSubscription(client).state?.status ?? "none"}</span>
    );
    expect(renderToString(<Probe />)).toBe("<span>none</span>");
  });

  test("should use the page's client by default", () => {
    createFakeBridge(TRIAL);
    const { result } = renderHook(() => useSubscription());
    expect(result.current.refresh).toBe(subscriptionClient.refresh);
  });
});
