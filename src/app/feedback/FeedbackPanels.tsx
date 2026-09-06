"use client";

import { useCallback, useState } from "react";

import { FeedbackBoard } from "./FeedbackBoard";
import { FeedbackForm } from "./FeedbackForm";

/**
 * The two halves of the feedback page, and the one piece of state they
 * share.
 *
 * On a phone they stack, write-then-read, which is the order you use them
 * in. From `lg` they sit side by side: the composer keeps a fixed column
 * on the left and the board takes the rest. The page used to cap
 * everything at 576px and pin it left, which on a laptop left half the
 * window empty beside a narrow strip of content.
 *
 * The composer sticks as the board scrolls. It is the shorter of the two
 * by a long way once the board fills up, and scrolling back to the top to
 * report the thing you just read about is the whole reason to put them
 * beside each other.
 *
 * `refreshKey` lives here because posting is one column's event and
 * showing it is the other's. It used to be the form's own state, back
 * when the form rendered the board inside itself.
 */
export function FeedbackPanels({
  userId,
  isAdmin,
  isQa,
  initialMatchId,
}: {
  userId: string;
  isAdmin: boolean;
  isQa: boolean;
  initialMatchId: string | null;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const onPosted = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <div className="mt-8 flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-12">
      {/* A fixed column rather than a share of the width: the composer is
          a text box and two buttons, and it does not read any better at
          500px than at 360. top-20 clears the 64px sticky header. */}
      <div className="w-full lg:sticky lg:top-20 lg:w-[360px] lg:shrink-0">
        <FeedbackForm
          userId={userId}
          isQa={isQa}
          initialMatchId={initialMatchId}
          onPosted={onPosted}
        />
      </div>
      {/* min-w-0 or a long unbroken title in a board row pushes the whole
          flex line wider than the page. */}
      <div className="min-w-0 flex-1">
        <FeedbackBoard
          isAdmin={isAdmin}
          isQa={isQa}
          userId={userId}
          refreshKey={refreshKey}
        />
      </div>
    </div>
  );
}
