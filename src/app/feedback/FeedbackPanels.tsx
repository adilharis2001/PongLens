"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { BottomSheet } from "@/components/BottomSheet";
import { FabButton } from "@/components/Fab";
import { FeedbackBoard } from "./FeedbackBoard";
import { FeedbackForm } from "./FeedbackForm";
import { RoadmapTab } from "./RoadmapTab";

type Tab = "feedback" | "roadmap";

/**
 * The board page below its title: two tabs, Feedback and Roadmap.
 *
 * Feedback is the posts and their threads. On a laptop (`lg` up) the
 * composer keeps a fixed column on the left and the board takes the
 * rest; the composer sticks as the board scrolls, because scrolling back
 * to the top to report the thing you just read about is the whole reason
 * to put them beside each other. On a phone the board IS the page and
 * writing is a sheet raised from the corner button, the iPhone app's own
 * arrangement.
 *
 * Roadmap is what is being built, what comes next and what shipped: the
 * same list as the public /roadmap page. No composer beside it and no
 * corner button; nothing on that tab is written by a player.
 *
 * The Top / New / Active sort the board carried went with the tabs
 * (Adil, 2026-09-16): with a few dozen posts the ranking by votes is the
 * only order worth having, and the stages a post moves through live on
 * the Roadmap now rather than as a filter rail over the list.
 *
 * `?compose=1` opens the sheet on arrival (Home's "add yours" link);
 * `?tab=roadmap` lands on the roadmap.
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
  const [tab, setTab] = useState<Tab>("feedback");

  useEffect(() => {
    if (params.get("compose") === "1") setComposeOpen(true);
    if (params.get("tab") === "roadmap") setTab("roadmap");
  }, [params]);

  return (
    <div className="mt-6">
      <Tabs tab={tab} setTab={setTab} />

      {tab === "roadmap" ? (
        <div className="mt-8 max-w-3xl">
          <RoadmapTab />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-12">
          {/* A fixed column rather than a share of the width: the composer
              is a text box and two buttons, and it does not read any
              better at 500px than at 360. top-20 clears the 64px sticky
              header. */}
          <div className="hidden lg:sticky lg:top-20 lg:block lg:w-[360px] lg:shrink-0">
            <FeedbackForm userId={userId} isQa={isQa} onPosted={onPosted} />
          </div>
          {/* min-w-0 or a long unbroken title in a board row pushes the
              whole flex line wider than the page. */}
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
              <FeedbackForm userId={userId} isQa={isQa} onPosted={onPosted} bare autoFocus />
            </BottomSheet>
          </div>
        </div>
      )}
    </div>
  );
}

/** Two segments in the board's own pill, full width on a phone. */
function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: { key: Tab; label: string }[] = [
    { key: "feedback", label: "Feedback" },
    { key: "roadmap", label: "Roadmap" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Board sections"
      className="flex w-full rounded-full border border-edge bg-surface p-0.5 sm:w-auto sm:inline-flex"
    >
      {tabs.map((t) => {
        const on = tab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => setTab(t.key)}
            className={`min-h-9 flex-1 rounded-full px-5 text-sm font-semibold transition-colors sm:flex-none sm:px-6 ${
              on ? "bg-surface-2 text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
