"""Offline serve-start proposal guard; not wired into the live worker.

Entry point: correct_start. Caller supplies structural starts and machine-only
pair/contact evidence, all in the SAME clock. Apply existing clip padding only
after this function returns. No filesystem, model, database, label, identifier,
score, winner, or UI dependency. An unflagged proposal is not certified safe.

Two frozen rules from the 2026-09-25 private serve-start protocol:
* reject a pair with monotonicity < .85 or an intervening machine contact;
* reject a pair > 1.2s after every machine contact unless a machine serve
  anchor is within 1.2s of its first bounce.

Malformed evidence retains the original start. A malformed original start
raises ValueError because there is no valid fallback. This function has no
end-time input: its caller remains responsible for validating the point window.
"""
from collections.abc import Mapping
from math import isfinite
from numbers import Real


def _finite_nonnegative(value):
    return (isinstance(value, Real) and not isinstance(value, bool)
            and isfinite(value) and value >= 0)


def correct_start(existing_start, proposed_start, pair, contacts, serve_s=None):
    """Return {start, reasons}; input mappings/sequences are never mutated.

    pair: {first: seconds, monotonicity: ratio, between_machine_contacts: count}
    contacts: list/tuple of machine-contact seconds; [] means known empty,
    None means missing evidence. serve_s: machine anchor seconds or None.
    Extra pair fields are ignored; callers must never derive these three
    machine fields from an owner's annotations.
    """
    if not _finite_nonnegative(existing_start):
        raise ValueError("existing_start must be finite nonnegative seconds")
    fallback = {"start": existing_start, "reasons": ["invalid_evidence"]}
    if pair is None:
        return {"start": existing_start, "reasons": ["no_pair"]}
    if not _finite_nonnegative(proposed_start) or not isinstance(pair, Mapping):
        return fallback
    first = pair.get("first")
    monotonicity = pair.get("monotonicity")
    between = pair.get("between_machine_contacts")
    if (not _finite_nonnegative(first)
            or not _finite_nonnegative(monotonicity)
            or monotonicity > 1 + 1e-9
            or not isinstance(between, int) or isinstance(between, bool) or between < 0
            or not isinstance(contacts, (list, tuple))
            or not all(_finite_nonnegative(t) for t in contacts)
            or (serve_s is not None and not _finite_nonnegative(serve_s))):
        return fallback
    reasons = []
    if monotonicity < .85 or between > 0:
        reasons.append("incoherent_pair")
    if contacts:
        anchored = serve_s is not None and abs(first - serve_s) <= 1.2
        if first - max(contacts) > 1.2 and not anchored:
            reasons.append("stale_unsupported_pair")
    return {"start": existing_start if reasons else max(existing_start, proposed_start),
            "reasons": reasons}
