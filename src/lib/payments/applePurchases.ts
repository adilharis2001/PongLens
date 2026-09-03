import "server-only";

import {
  Environment,
  SignedDataVerifier,
  type JWSTransactionDecodedPayload,
} from "@apple/app-store-server-library";

import { APPLE_ROOT_CERTIFICATES } from "./appleRoot";

/**
 * Verifying what the phone says it bought.
 *
 * StoreKit hands the app a signed transaction and the app forwards it
 * here. The app's own opinion of that transaction is worth nothing —
 * a modified build can say anything — so the only thing that counts is
 * Apple's signature over the payload, checked against a certificate
 * chain ending at Apple's root.
 */

export const BUNDLE_ID = "com.ponglens.PongLens";
/** The app's numeric App Store id. Absent in sandbox, required for production. */
export const APP_APPLE_ID = 6802642381;

/**
 * A pack key becomes exactly one product id, and nothing else may.
 *
 * This is the join between our packs and Apple's catalogue, and it is
 * load-bearing for money: a purchase is only honoured when the product
 * Apple says was bought is the product this pack maps to. Without that
 * check, buying the cheapest pack and pointing it at a pending row for
 * the largest one would work.
 */
export function productIdForPack(packKey: string): string {
  return `${BUNDLE_ID}.${packKey}`;
}

/**
 * Production first, then sandbox. A build from TestFlight or a sandbox
 * account produces sandbox-signed transactions, and the two environments
 * are separate signing worlds — the same receipt never validates in
 * both, so trying one and falling back is how you serve real customers
 * and testers from one endpoint.
 *
 * Xcode's local StoreKit testing is deliberately NOT accepted: those
 * receipts are signed by a certificate generated on the developer's own
 * machine, so honouring them would mean accepting a signature anyone can
 * produce. Local testing proves the interface; a sandbox purchase from a
 * real device proves the money.
 */
const ENVIRONMENTS: Environment[] = [
  Environment.PRODUCTION,
  Environment.SANDBOX,
];

const verifiers = new Map<Environment, SignedDataVerifier>();

function verifierFor(environment: Environment): SignedDataVerifier {
  let verifier = verifiers.get(environment);
  if (!verifier) {
    verifier = new SignedDataVerifier(
      APPLE_ROOT_CERTIFICATES,
      // Online revocation checks would put an Apple network call in the
      // middle of a purchase, and a blip there would fail a payment the
      // customer has already made. The chain and expiry are still
      // checked offline.
      false,
      environment,
      BUNDLE_ID,
      environment === Environment.PRODUCTION ? APP_APPLE_ID : undefined,
    );
    verifiers.set(environment, verifier);
  }
  return verifier;
}

export type VerifiedTransaction = {
  transactionId: string;
  productId: string;
  /** Our platform_purchases id, carried through Apple as appAccountToken. */
  purchaseId: string | null;
  environment: Environment;
};

/**
 * Verify a signed transaction and pull out only the fields we trust.
 *
 * Returns null when no environment accepts it, which covers a forged
 * receipt, a receipt for another app, and an Xcode-local one. The caller
 * must treat null as "grant nothing".
 */
export async function verifySignedTransaction(
  signedTransaction: string,
): Promise<VerifiedTransaction | null> {
  for (const environment of ENVIRONMENTS) {
    let payload: JWSTransactionDecodedPayload;
    try {
      payload = await verifierFor(environment).verifyAndDecodeTransaction(
        signedTransaction,
      );
    } catch {
      continue; // wrong environment, or not genuine — try the next
    }
    // Belt and braces: the verifier is constructed with our bundle id and
    // checks it, but this is money, so the assertion is written where a
    // reader can see it.
    if (payload.bundleId !== BUNDLE_ID) return null;
    if (!payload.transactionId || !payload.productId) return null;
    return {
      transactionId: payload.transactionId,
      productId: payload.productId,
      purchaseId: payload.appAccountToken ?? null,
      environment,
    };
  }
  return null;
}

export type VerifiedNotification = {
  notificationType: string;
  /** The transaction the notification is about, when it names one. */
  transactionId: string | null;
};

/**
 * Verify an App Store Server Notification and pull out what it concerns.
 *
 * The signature is the authentication for that endpoint — there is no
 * shared secret — so a null here means the post was not from Apple and
 * must change nothing.
 */
export async function verifyAppleNotification(
  signedPayload: string,
): Promise<VerifiedNotification | null> {
  for (const environment of ENVIRONMENTS) {
    try {
      const verifier = verifierFor(environment);
      const payload = await verifier.verifyAndDecodeNotification(signedPayload);
      if (!payload.notificationType) return null;

      // The transaction lives in a second, separately-signed blob inside
      // the notification, so it gets verified in its own right rather
      // than trusted because its envelope was good.
      let transactionId: string | null = null;
      const signedTransactionInfo = payload.data?.signedTransactionInfo;
      if (signedTransactionInfo) {
        try {
          const tx =
            await verifier.verifyAndDecodeTransaction(signedTransactionInfo);
          transactionId = tx.transactionId ?? null;
        } catch {
          return null; // envelope verified but contents did not: refuse
        }
      }
      return { notificationType: payload.notificationType, transactionId };
    } catch {
      continue; // wrong environment — try the other
    }
  }
  return null;
}
