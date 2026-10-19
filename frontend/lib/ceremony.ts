/**
 * The three steps of a SignSeen signing ceremony, in order.
 * Signed: the signer draws their signature.
 * Seen: the signer takes a photo as a witness.
 * Sealed: the document is hashed and the audit trail is sealed.
 */
export const CEREMONY_STEPS = ["Signed", "Seen", "Sealed"] as const;

export type CeremonyStep = (typeof CEREMONY_STEPS)[number];

/** "Signed. Seen. Sealed." — the product tagline, derived from the steps. */
export function ceremonyTagline(): string {
  return CEREMONY_STEPS.map((step) => `${step}.`).join(" ");
}
