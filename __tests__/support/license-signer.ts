import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";

import type { LicenseKey, LicensePlan } from "@handijit/core/license";

/** What a test may set on a license; everything else gets the backend's usual value. */
type LicenseInput = {
  readonly product?: string;
  readonly plan?: LicensePlan;
  readonly deviceId?: string;
  readonly limits?: Readonly<Record<string, number>>;
  /** Epoch milliseconds. */
  readonly issuedAt: number;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
  /** Epoch milliseconds; trial licenses only. */
  readonly trialEndsAt?: number;
  readonly issuer?: string;
};

/** A license as `POST /api/public/licenses` or `/api/customer/licenses` answers with it. */
type IssuedLicense = {
  readonly license: string;
  readonly plan: LicensePlan;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly trialEndsAt?: string;
  readonly limits: Readonly<Record<string, number>>;
  readonly serverTime: string;
};

const seconds = (moment: number): number => Math.floor(moment / 1000);
const base64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** The device id's hash as the backend writes it into the `device` claim. */
const deviceHashOf = (deviceId: string): string =>
  createHash("sha256").update(deviceId, "utf8").digest("hex");

/**
 * A license signer with a real Ed25519 key generated for this run: the same document format
 * the backend signs (`alg: EdDSA`, `typ: license+jwt`, `kid`), so `verifyLicense` of
 * `@handijit/core` checks it for real.
 */
const createLicenseSigner = (kid: string, defaultProduct = "notlar") => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const { x } = publicKey.export({ format: "jwk" });
  const key: LicenseKey = { kid, x: x as string };

  const sign_ = (
    input: LicenseInput,
    header: Readonly<Record<string, unknown>> = {}
  ): string => {
    const head = base64url({
      alg: "EdDSA",
      typ: "license+jwt",
      kid,
      ...header,
    });
    const body = base64url({
      iss: input.issuer ?? "handijit",
      product: input.product ?? defaultProduct,
      plan: input.plan ?? "trial",
      device: deviceHashOf(input.deviceId ?? ""),
      limits: input.limits ?? {},
      ...(input.trialEndsAt === undefined
        ? {}
        : { trialEndsAt: seconds(input.trialEndsAt) }),
      iat: seconds(input.issuedAt),
      exp: seconds(input.expiresAt),
      jti: randomUUID(),
    });
    const signature = sign(
      null,
      Buffer.from(`${head}.${body}`),
      privateKey
    ).toString("base64url");
    return `${head}.${body}.${signature}`;
  };

  const issue = (
    input: LicenseInput,
    serverTime: number = input.issuedAt
  ): IssuedLicense => ({
    license: sign_(input),
    plan: input.plan ?? "trial",
    issuedAt: new Date(input.issuedAt).toISOString(),
    expiresAt: new Date(input.expiresAt).toISOString(),
    ...(input.trialEndsAt === undefined
      ? {}
      : { trialEndsAt: new Date(input.trialEndsAt).toISOString() }),
    limits: input.limits ?? {},
    serverTime: new Date(serverTime).toISOString(),
  });

  return { key, sign: sign_, issue };
};

type LicenseSigner = ReturnType<typeof createLicenseSigner>;

export type { IssuedLicense, LicenseInput, LicenseSigner };
export { deviceHashOf };
export default createLicenseSigner;
