import { afterEach, describe, expect, test, vi } from "vitest";

import createSubscriptionClient, {
  subscriptionClient,
} from "../../lib/renderer/create-subscription-client";
import type { SubscriptionState } from "../../lib/types";
import { VALID_STATES } from "../shared/subscription-state.fixture";
import createFakeBridge from "./bridge.fixture";

const [LOADING, TRIAL] = VALID_STATES as [SubscriptionState, SubscriptionState];
const at = (state: SubscriptionState, revision: number): SubscriptionState => ({
  ...state,
  revision,
});

// Every client a test connects is disconnected after it, so that no window listener is left.
const connections: (() => void)[] = [];
const connect = (
  client: ReturnType<typeof createSubscriptionClient>,
  listener: (state: SubscriptionState) => void = vi.fn()
): (() => void) => {
  const stop = client.subscribe(listener);
  connections.push(stop);
  return stop;
};

afterEach(() => {
  for (const stop of connections.splice(0)) stop();
});

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("createSubscriptionClient", () => {
  test("should connect with the first listener and ask for the state", async () => {
    const bridge = createFakeBridge(at(TRIAL, 3));
    const client = createSubscriptionClient();
    expect(client.getState()).toBeNull();
    const listener = vi.fn();
    connect(client, listener);
    await flush();
    expect(bridge.invoke["subscription:get-state"]).toHaveBeenCalledTimes(1);
    expect(client.getState()).toEqual(at(TRIAL, 3));
    expect(listener).toHaveBeenCalledWith(at(TRIAL, 3));
  });

  test("should keep the newest state by revision and ignore what is not a state", async () => {
    const bridge = createFakeBridge(at(LOADING, 5));
    const client = createSubscriptionClient();
    const listener = vi.fn();
    connect(client, listener);
    await flush();
    bridge.publish(at(TRIAL, 4));
    bridge.publish({ status: "trial", license: "a.b.c" });
    expect(client.getState()).toEqual(at(LOADING, 5));
    bridge.publish(at(TRIAL, 6));
    expect(client.getState()).toEqual(at(TRIAL, 6));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("should disconnect when the last listener leaves", async () => {
    const bridge = createFakeBridge();
    const client = createSubscriptionClient();
    const stopFirst = connect(client);
    const stopSecond = connect(client);
    await flush();
    expect(bridge.listenerCount()).toBe(1);
    stopFirst();
    stopFirst();
    expect(bridge.listenerCount()).toBe(1);
    stopSecond();
    expect(bridge.listenerCount()).toBe(0);
  });

  test("should pass the window's online event to main while connected", async () => {
    const bridge = createFakeBridge();
    const client = createSubscriptionClient();
    const stop = connect(client);
    await flush();
    globalThis.dispatchEvent(new Event("online"));
    await flush();
    expect(bridge.invoke["subscription:refresh"]).toHaveBeenCalledTimes(1);
    stop();
    globalThis.dispatchEvent(new Event("online"));
    await flush();
    expect(bridge.invoke["subscription:refresh"]).toHaveBeenCalledTimes(1);
  });

  test("should swallow a refused refresh from the online event", async () => {
    const bridge = createFakeBridge();
    bridge.invoke["subscription:refresh"].mockRejectedValueOnce(
      new Error("refused")
    );
    const client = createSubscriptionClient();
    connect(client);
    await flush();
    globalThis.dispatchEvent(new Event("online"));
    await flush();
    expect(bridge.invoke["subscription:refresh"]).toHaveBeenCalledTimes(1);
  });

  test("should stay quiet without a bridge", async () => {
    vi.stubGlobal("desktop", undefined);
    const client = createSubscriptionClient();
    const listener = vi.fn();
    const stop = connect(client, listener);
    await flush();
    expect(client.getState()).toBeNull();
    stop();
    await expect(client.refresh()).rejects.toThrow();
  });

  test("should swallow a refused first answer", async () => {
    const bridge = createFakeBridge();
    bridge.invoke["subscription:get-state"].mockRejectedValueOnce(
      new Error("refused")
    );
    const client = createSubscriptionClient();
    connect(client);
    await flush();
    expect(client.getState()).toBeNull();
  });

  test("should pass every action to main and keep the answered state", async () => {
    const bridge = createFakeBridge(at(TRIAL, 2));
    const client = createSubscriptionClient();
    expect(await client.refresh()).toEqual(at(TRIAL, 2));
    bridge.set(at(TRIAL, 3));
    expect(await client.loadPlans()).toEqual(at(TRIAL, 3));
    bridge.set(at(TRIAL, 4));
    expect(await client.cancelPurchase()).toEqual(at(TRIAL, 4));
    expect(await client.purchase("yearly")).toBe(true);
    expect(bridge.invoke["subscription:purchase"]).toHaveBeenCalledWith({
      interval: "yearly",
    });
    expect(await client.manage()).toBe(true);
  });

  test("should offer one client for the page", () => {
    expect(typeof subscriptionClient.subscribe).toBe("function");
  });
});
