/**
 * How many WebCrypto operations of `@handijit/core/license` (`verifyLicense`, `hashDeviceId`)
 * are running. Node runs them on its thread pool, so how many event-loop turns they take
 * depends on the machine; `settle` waits for this count instead of guessing a number of turns.
 */
const PENDING_CRYPTO = { count: 0 };

export default PENDING_CRYPTO;
