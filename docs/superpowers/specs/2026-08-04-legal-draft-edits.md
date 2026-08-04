# Legal copy drafts for paid coach reviews — NOT applied

Proposed edits for Adil's review. The live terms and privacy pages are
untouched; nothing here ships without sign-off.

## Terms of Service (src/app/terms/page.tsx)

Add a section, suggested placement after the existing service description:

> ## Paid coach reviews
>
> Coaches on PongLens can sell match reviews. The coach is the provider of
> the coaching service; PongLens provides the video tools, the order
> workflow, and payment processing through Stripe. When you buy a review,
> you pay the coach, and PongLens keeps a platform fee.
>
> A coach sets their own price, scope and expected turnaround. You can
> cancel for a full refund any time before the coach starts, and if a
> started review is more than a week past its promised date. Delivered
> reviews are final. Refunds go back to your original payment method.
>
> Coaches receive payouts through Stripe after a review completes. Stripe
> handles identity checks, bank details and tax forms; PongLens never sees
> them.

Also update the line "We may add limits, introduce paid plans, or change
features at any time." — it can stay as is; it already covers this.

## Privacy Policy (src/app/privacy/page.tsx)

The existing "no payment details stored" statement (around line 265)
remains true but should say who does store them:

> Payments are processed by Stripe. Your card details, and a coach's
> identity and bank details, go to Stripe directly and never touch
> PongLens servers. We store the order itself: what was bought, from
> which coach, its price, and its status.

Add to the data-shared-with-processors list: Stripe (payments), alongside
the existing processors.

## For the morning

- Read both drafts, adjust tone as needed, then I fold them into the live
  pages as plain copy edits.
- Consider whether coaches need a short "coach terms" paragraph (you are
  responsible for the advice you sell, PongLens facilitates payment) —
  ttEDGE and Metafy both carry one.
