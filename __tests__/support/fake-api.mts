import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for Han Dijit's backend, faithful to the parts of its contract the Electron smoke
// test relies on (docs/lisans.md and docs/abonelik.md of the backend):
//
// - desktop sign-in: a one-time code is exchanged once for a session; a refresh rotates the
//   refresh token; a logout answers 204; a dead access token is refused with an empty 401;
// - `POST /api/public/licenses` starts the trial of a device id at its first request and
//   answers `403 TRIAL_EXPIRED` (`trialEndedAt`) once it is over; the license's `exp` is
//   `min(iat + 72h, trialEndsAt)`;
// - `POST /api/customer/licenses` needs a session; without a live subscription it answers
//   `403 SUBSCRIPTION_REQUIRED`; the first device that asks is bound, another one gets
//   `409 SUBSCRIPTION_DEVICE_MISMATCH` (`boundDevice: { name, os }`);
// - `GET /api/public/products/{slug}/plans` lists the plans with their prices in kuruş;
// - licenses are EdDSA JWS (`typ: license+jwt`, `kid`) signed by a key made for this run;
//   its public half is handed to the program as its trust root.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const LICENSE_TTL_MS = 72 * HOUR_MS;
const TRIAL_MS = 7 * DAY_MS;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

type FakeUser = { id: number; email: string; name: string };

type RecordedRequest = {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
  isAnswered: boolean;
};

type FakeSession = {
  userId: number;
  refreshToken: string;
  accessToken: string;
  isRevoked: boolean;
};

type FakeSubscription = {
  plan: "monthly" | "yearly";
  boundDevice: { id: string; name: string | null; os: string } | null;
};

type FakePlan = {
  interval: string;
  priceKurus: number;
  currency: string;
  available: boolean;
};

type FakeApi = {
  /** The base address to give to the client. */
  readonly url: string;
  /** The public key the program must trust: `{ kid, x }`. */
  readonly key: { kid: string; x: string };
  /** Every request that arrived, in order. */
  readonly requests: RecordedRequest[];
  /** Every session ever created. */
  readonly sessions: FakeSession[];
  /** Every device id that asked for a trial, with the end of its trial. */
  readonly trials: Map<string, number>;
  /** The subscriptions by customer id. */
  readonly subscriptions: Map<number, FakeSubscription>;
  /** What the consent page does on approval: issues a one-time code for a challenge. */
  readonly authorize: (input: {
    user: FakeUser;
    codeChallenge: string;
    redirectUri: string;
  }) => string;
  /** Gives a customer a live subscription, as a paid checkout does. */
  readonly subscribe: (userId: number, plan: "monthly" | "yearly") => void;
  /** Ends every trial now. */
  readonly endTrials: () => void;
  /** Ends the trial of one device id, as if it had run out before. */
  readonly expireTrial: (deviceId: string) => void;
  /** Replaces the plans on sale. */
  readonly setPlans: (plans: FakePlan[]) => void;
  /** Drops every connection without an answer while `true`. */
  readonly setOffline: (isOffline: boolean) => void;
  /** Requests to a path, counted. */
  readonly countOf: (path: string) => number;
  /** Stops the server. */
  readonly close: () => Promise<void>;
};

const PLANS: FakePlan[] = [
  { interval: "monthly", priceKurus: 14_990, currency: "TRY", available: true },
  { interval: "yearly", priceKurus: 149_900, currency: "TRY", available: true },
];

const token = (): string => randomBytes(24).toString("base64url");
const challengeOf = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");
const segment = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const seconds = (moment: number): number => Math.floor(moment / 1000);

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const startFakeApi = async ({ product = "notlar" } = {}): Promise<FakeApi> => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key = {
    kid: "smoke-2026",
    x: String(publicKey.export({ format: "jwk" }).x),
  };
  const users = new Map<number, FakeUser>();
  const codes = new Map<
    string,
    { userId: number; codeChallenge: string; redirectUri: string }
  >();
  const sessions: FakeSession[] = [];
  const requests: RecordedRequest[] = [];
  const trials = new Map<string, number>();
  const subscriptions = new Map<number, FakeSubscription>();
  let plans = PLANS;
  let isOffline = false;

  const json = (
    response: ServerResponse,
    status: number,
    body: unknown
  ): void => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  };

  const problem = (
    response: ServerResponse,
    status: number,
    code: string,
    detail: string,
    extensions: Record<string, unknown> = {}
  ): void => {
    response.writeHead(status, { "Content-Type": "application/problem+json" });
    response.end(
      JSON.stringify({
        type: "about:blank",
        title: code,
        status,
        detail,
        code,
        ...extensions,
      })
    );
  };

  const openSession = (user: FakeUser): Record<string, unknown> => {
    const session: FakeSession = {
      userId: user.id,
      refreshToken: token(),
      accessToken: token(),
      isRevoked: false,
    };
    sessions.push(session);
    return {
      accessToken: session.accessToken,
      expiresInSeconds: 900,
      refreshToken: session.refreshToken,
      user: {
        ...user,
        role: "CUSTOMER",
        roleLabel: "Müşteri",
        createdAt: "2026-01-05T09:00:00Z",
      },
    };
  };

  const sessionOf = (
    authorization: string | undefined
  ): FakeSession | undefined =>
    sessions.find(
      (candidate) =>
        !candidate.isRevoked &&
        authorization === `Bearer ${candidate.accessToken}`
    );

  const issue = (
    response: ServerResponse,
    deviceId: string,
    plan: "trial" | "monthly" | "yearly",
    trialEndsAt?: number
  ): void => {
    const now = Date.now();
    const expiresAt =
      trialEndsAt === undefined
        ? now + LICENSE_TTL_MS
        : Math.min(now + LICENSE_TTL_MS, trialEndsAt);
    const limits = plan === "trial" ? { notes: 100 } : {};
    const head = segment({ alg: "EdDSA", typ: "license+jwt", kid: key.kid });
    const body = segment({
      iss: "handijit",
      product,
      plan,
      device: createHash("sha256").update(deviceId, "utf8").digest("hex"),
      limits,
      ...(trialEndsAt === undefined
        ? {}
        : { trialEndsAt: seconds(trialEndsAt) }),
      iat: seconds(now),
      exp: seconds(expiresAt),
      jti: randomUUID(),
    });
    const signature = sign(
      null,
      Buffer.from(`${head}.${body}`),
      privateKey
    ).toString("base64url");
    json(response, 200, {
      license: `${head}.${body}.${signature}`,
      plan,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      ...(trialEndsAt === undefined
        ? {}
        : { trialEndsAt: new Date(trialEndsAt).toISOString() }),
      limits,
      serverTime: new Date(now).toISOString(),
    });
  };

  // The fields both license endpoints take; `undefined` when the body is not valid.
  const licenseRequestOf = (
    body: unknown
  ):
    { deviceId: string; deviceName: string | null; os: string } | undefined => {
    if (
      !isRecord(body) ||
      typeof body.deviceId !== "string" ||
      !DEVICE_ID_PATTERN.test(body.deviceId) ||
      (body.os !== "windows" && body.os !== "macos") ||
      (body.arch !== "x64" && body.arch !== "arm64") ||
      typeof body.appVersion !== "string" ||
      typeof body.product !== "string"
    ) {
      return undefined;
    }
    return {
      deviceId: body.deviceId,
      deviceName: typeof body.deviceName === "string" ? body.deviceName : null,
      os: body.os,
    };
  };

  const trialLicense = (response: ServerResponse, body: unknown): void => {
    const asked = licenseRequestOf(body);
    if (asked === undefined) {
      problem(response, 400, "VALIDATION_ERROR", "Eksik alan.");
      return;
    }
    if (isRecord(body) && body.product !== product) {
      problem(response, 404, "NOT_FOUND", "Program bulunamadı.");
      return;
    }
    const trialEndsAt = trials.get(asked.deviceId) ?? Date.now() + TRIAL_MS;
    trials.set(asked.deviceId, trialEndsAt);
    if (Date.now() >= trialEndsAt) {
      problem(response, 403, "TRIAL_EXPIRED", "Deneme süresi doldu.", {
        trialEndedAt: new Date(trialEndsAt).toISOString(),
      });
      return;
    }
    issue(response, asked.deviceId, "trial", trialEndsAt);
  };

  const paidLicense = (
    response: ServerResponse,
    body: unknown,
    authorization: string | undefined
  ): void => {
    const session = sessionOf(authorization);
    if (session === undefined) {
      response.writeHead(401).end();
      return;
    }
    const asked = licenseRequestOf(body);
    if (asked === undefined) {
      problem(response, 400, "VALIDATION_ERROR", "Eksik alan.");
      return;
    }
    const subscription = subscriptions.get(session.userId);
    if (subscription === undefined) {
      problem(response, 403, "SUBSCRIPTION_REQUIRED", "Etkin abonelik yok.");
      return;
    }
    subscription.boundDevice ??= {
      id: asked.deviceId,
      name: asked.deviceName,
      os: asked.os,
    };
    if (subscription.boundDevice.id !== asked.deviceId) {
      problem(
        response,
        409,
        "SUBSCRIPTION_DEVICE_MISMATCH",
        "Abonelik başka cihaza bağlı.",
        {
          boundDevice: {
            name: subscription.boundDevice.name,
            os: subscription.boundDevice.os,
          },
        }
      );
      return;
    }
    issue(response, asked.deviceId, subscription.plan);
  };

  const server = createServer((request, response) => {
    void (async () => {
      const path = String(request.url).split("?")[0] as string;
      const method = String(request.method);
      const authorization = request.headers.authorization;
      const body = await readBody(request);
      const recorded: RecordedRequest = {
        method,
        path,
        authorization,
        body,
        isAnswered: false,
      };
      requests.push(recorded);
      if (isOffline) {
        request.socket.destroy();
        return;
      }
      recorded.isAnswered = true;

      if (method === "POST" && path === "/api/public/desktop/token") {
        const issued =
          isRecord(body) && typeof body.code === "string"
            ? codes.get(body.code)
            : undefined;
        if (isRecord(body) && typeof body.code === "string")
          codes.delete(body.code);
        const user =
          issued === undefined ? undefined : users.get(issued.userId);
        if (
          issued === undefined ||
          user === undefined ||
          !isRecord(body) ||
          typeof body.codeVerifier !== "string" ||
          challengeOf(body.codeVerifier) !== issued.codeChallenge ||
          body.redirectUri !== issued.redirectUri
        ) {
          problem(
            response,
            400,
            "DESKTOP_CODE_INVALID",
            "Giriş kodu geçersiz."
          );
          return;
        }
        json(response, 200, openSession(user));
      } else if (method === "POST" && path === "/api/auth/refresh") {
        const presented = isRecord(body) ? body.refreshToken : undefined;
        const session = sessions.find(
          (candidate) =>
            candidate.refreshToken === presented && !candidate.isRevoked
        );
        const user =
          session === undefined ? undefined : users.get(session.userId);
        if (session === undefined || user === undefined) {
          problem(response, 401, "INVALID_TOKEN", "Oturum geçersiz.");
          return;
        }
        session.isRevoked = true;
        json(response, 200, openSession(user));
      } else if (method === "POST" && path === "/api/auth/logout") {
        for (const session of sessions) {
          if (isRecord(body) && session.refreshToken === body.refreshToken)
            session.isRevoked = true;
        }
        response.writeHead(204).end();
      } else if (method === "GET" && path === "/api/auth/me") {
        const session = sessionOf(authorization);
        const user =
          session === undefined ? undefined : users.get(session.userId);
        if (user === undefined) {
          response.writeHead(401).end();
          return;
        }
        json(response, 200, {
          ...user,
          role: "CUSTOMER",
          roleLabel: "Müşteri",
          createdAt: "2026-01-05T09:00:00Z",
        });
      } else if (method === "POST" && path === "/api/public/licenses") {
        trialLicense(response, body);
      } else if (method === "POST" && path === "/api/customer/licenses") {
        paidLicense(response, body, authorization);
      } else if (
        method === "GET" &&
        path === `/api/public/products/${product}/plans`
      ) {
        json(response, 200, plans);
      } else {
        problem(response, 404, "NOT_FOUND", "Bulunamadı.");
      }
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    key,
    requests,
    sessions,
    trials,
    subscriptions,
    authorize: ({ user, codeChallenge, redirectUri }) => {
      users.set(user.id, { ...user });
      const code = randomBytes(32).toString("base64url");
      codes.set(code, { userId: user.id, codeChallenge, redirectUri });
      return code;
    },
    subscribe: (userId, plan) => {
      subscriptions.set(userId, { plan, boundDevice: null });
    },
    endTrials: () => {
      const now = Date.now();
      for (const deviceId of trials.keys()) trials.set(deviceId, now - 1000);
    },
    expireTrial: (deviceId) => {
      trials.set(deviceId, Date.now() - DAY_MS);
    },
    setPlans: (list) => {
      plans = list;
    },
    setOffline: (value) => {
      isOffline = value;
    },
    countOf: (path) =>
      requests.filter((request) => request.path === path).length,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
};

export type {
  FakeApi,
  FakePlan,
  FakeSession,
  FakeSubscription,
  FakeUser,
  RecordedRequest,
};
export default startFakeApi;
