import { act, render, waitFor } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { expect } from "vitest";

import createSubscriptionClient from "../../lib/renderer/create-subscription-client";
import type { SubscriptionClient } from "../../lib/renderer/create-subscription-client";
import type { SubscriptionState } from "../../lib/types";
import createFakeBridge from "../renderer/bridge.fixture";
import type { FakeBridge } from "../renderer/bridge.fixture";

type Mounted = RenderResult & {
  readonly bridge: FakeBridge;
  readonly client: SubscriptionClient;
  /** Main announces a new state; the revision is taken care of. */
  readonly publish: (state: SubscriptionState) => void;
};

/**
 * Renders a component over the real client and a scripted bridge, and waits until the state
 * main answers with has reached the page.
 */
const mount = async (
  state: SubscriptionState,
  element: (client: SubscriptionClient) => ReactElement
): Promise<Mounted> => {
  const bridge = createFakeBridge(state);
  const client = createSubscriptionClient();
  const view = render(element(client));
  await waitFor(() => {
    expect(client.getState()).not.toBeNull();
  });
  let revision = state.revision;
  return {
    ...view,
    bridge,
    client,
    publish: (next) => {
      revision += 1;
      act(() => {
        bridge.publish({ ...next, revision });
      });
    },
  };
};

export type { Mounted };
export default mount;
