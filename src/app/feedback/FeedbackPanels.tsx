"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { BottomSheet } from "@/components/BottomSheet";
import { FabButton } from "@/components/Fab";
import { FeedbackBoard } from "./FeedbackBoard";
import { FeedbackForm } from "./FeedbackForm";

/**
 * The two halves of the feedback page, and the one piece of state they
 * share.
 *
 * On a laptop (`lg` up) they sit side by side: the composer keeps a fixed
 * column on the left and the board takes the rest. The composer sticks as
 * the board scrolls, because scrolling back to the top to report the
 * thing you just read about is the whole reason to put them beside each
 * other.
 *
 * On a phone the board IS the page and writing is a sheet raised from the
 * corner button — the iPhone app's own arrangement, and the one every
 * other list in the app uses (Home, Matches, Journal). The composer used
 * to sit above the board on a phone, which pushed the thing people came
 * to read below the fold behind an empty text box.
 *
 * `?compose=1` opens the sheet on arrival, for the Home card's "add
 * yours" link.
 *
 * `refreshKey` lives here because posting is one column's event and
 * showing it is the other's.
 */
export function FeedbackPanels({
  userId,
  isAdmin,
  isQa,
}: {
  userId: string;
  isAdmin: boolean;
  isQa: boolean;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const onPosted = useCallback(() => setRefreshKey((k) => k + 1), []);
  const params = useSearchParams();
  const [composeOpen, setComposeOpen] = useState(false);

  useEffect(() => {
    if (params.get("compose") === "1") setComposeOpen(true);
  }, [params]);

  return (
    <div className="mt-6 flex flex-col gap-10 lg:mt-8 lg:flex-row lg:items-start lg:gap-12">
      {/* A fixed column rather than a share of the width: the composer is
          a text box and two buttons, and it does not read any better at
          500px than at 360. top-20 clears the 64px sticky header. */}
      <div className="hidden lg:sticky lg:top-20 lg:block lg:w-[360px] lg:shrink-0">
        <FeedbackForm userId={userId} isQa={isQa} onPosted={onPosted} />
      </div>
      {/* min-w-0 or a long unbroken title in a board row pushes the whole
          flex line wider than the page. */}
      <div className="min-w-0 flex-1">
        <FeedbackBoard isAdmin={isAdmin} isQa={isQa} userId={userId} refreshKey={refreshKey} />
      </div>

      <div className="lg:hidden">
        {!composeOpen && (
          <FabButton label="New feedback" onClick={() => setComposeOpen(true)} />
        )}
        <BottomSheet
          open={composeOpen}
          title="New feedback"
          onClose={() => setComposeOpen(false)}
          widthClass="sm:max-w-md"
          autoFocusClose={false}
        >
          <FeedbackForm
            userId={userId}
            isQa={isQa}
            onPosted={onPosted}
            bare
            autoFocus
          />
        </BottomSheet>
      </div>
    </div>
  );
}
