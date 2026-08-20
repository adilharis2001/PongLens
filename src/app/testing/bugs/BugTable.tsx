"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  KIND_LABEL,
  OPEN_STATUSES,
  SEVERITY_LABEL,
  SEVERITY_RANK,
  STATUS_META,
  allowedStatuses,
  type Bug,
  type BugSeverity,
  type BugStatus,
} from "@/lib/qa/bugs";
import { AREA_TITLE } from "@/lib/qa/testLibrary";
import { BugThread } from "./BugThread";

const SEVERITY_CHIP: Record<BugSeverity, string> = {
  blocker: "border-red-400/40 bg-red-400/10 text-red-300",
  major: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  minor: "border-edge bg-surface-2 text-zinc-400",
};

function Pill({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3.5 py-1 text-xs font-semibold transition-colors ${
        on
          ? "border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow"
          : "border-edge text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatSeconds(v: number | null) {
  if (v === null) return null;
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function BugTable({
  isAdmin,
  userId,
}: {
  isAdmin: boolean;
  userId: string;
}) {
  const [bugs, setBugs] = useState<Bug[] | null>(null);
  const [scope, setScope] = useState<"open" | "mine" | "all">(() => {
    // Arriving from a notification means one specific bug, which may well
    // be closed and hidden by the default filter. Show everything rather
    // than land them on a list that does not contain the row they asked
    // for.
    if (typeof window === "undefined") return "open";
    return new URLSearchParams(window.location.search).get("bug")
      ? "all"
      : "open";
  });
  const [severity, setSeverity] = useState<BugSeverity | "all">("all");
  const [query, setQuery] = useState("");
  // Seeded from ?bug=, which is where the notification bell points. A
  // bell that drops you on a list of eighteen rows and leaves you to find
  // the one it was about has not really taken you anywhere.
  const [openId, setOpenId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("bug");
  });
  const [busyId, setBusyId] = useState<string | null>(null);

  const viewer = isAdmin ? "owner" : "tester";

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("qa_bugs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data) setBugs(data as Bug[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = useCallback(
    async (bug: Bug, status: BugStatus) => {
      setBusyId(bug.id);
      // Optimistic: the table is the working surface and a round trip on
      // every triage would make it feel like a form.
      setBugs((prev) =>
        prev?.map((b) => (b.id === bug.id ? { ...b, status } : b)) ?? null,
      );
      const supabase = createClient();
      const { error } = await supabase
        .from("qa_bugs")
        .update({ status })
        .eq("id", bug.id);
      if (error) {
        setBugs((prev) => prev?.map((b) => (b.id === bug.id ? bug : b)) ?? null);
      }
      setBusyId(null);
    },
    [],
  );

  const visible = useMemo(() => {
    if (!bugs) return [];
    const q = query.trim().toLowerCase();
    return bugs
      .filter((b) => {
        if (scope === "open" && !OPEN_STATUSES.includes(b.status)) return false;
        if (scope === "mine") {
          const waiting = STATUS_META[b.status].waitingOn;
          if (waiting !== viewer) return false;
        }
        if (severity !== "all" && b.severity !== severity) return false;
        if (q) {
          const hay = [b.title, b.steps, b.actual, b.case_id, b.area]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        if (bySeverity !== 0) return bySeverity;
        return b.created_at.localeCompare(a.created_at);
      });
  }, [bugs, scope, severity, query, viewer]);

  if (bugs === null) {
    return <p className="mt-8 text-sm text-zinc-600">Loading…</p>;
  }

  return (
    <div>
      <div className="mt-6 flex flex-col gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search bugs"
          className="w-full rounded-xl border border-edge bg-ink/60 px-4 py-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/50"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Pill on={scope === "open"} onClick={() => setScope("open")}>
            Open
          </Pill>
          <Pill on={scope === "mine"} onClick={() => setScope("mine")}>
            Waiting on me
          </Pill>
          <Pill on={scope === "all"} onClick={() => setScope("all")}>
            Everything
          </Pill>
          <span className="mx-1 h-4 w-px bg-edge" aria-hidden="true" />
          <Pill on={severity === "all"} onClick={() => setSeverity("all")}>
            Any severity
          </Pill>
          {(Object.keys(SEVERITY_LABEL) as BugSeverity[]).map((s) => (
            <Pill key={s} on={severity === s} onClick={() => setSeverity(s)}>
              {SEVERITY_LABEL[s]}
            </Pill>
          ))}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <p className="text-sm text-zinc-500">
          {visible.length} bug{visible.length === 1 ? "" : "s"}
        </p>
        <a
          href="/api/qa/export?what=bugs"
          className="text-sm font-medium text-zinc-400 transition-colors hover:text-cyan-glow"
        >
          Download as a spreadsheet
        </a>
      </div>

      {visible.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-500">
          {bugs.length === 0
            ? "Nothing filed yet."
            : "Nothing matches those filters."}
        </p>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-2xl border border-edge bg-surface">
          {visible.map((b) => {
            const open = openId === b.id;
            const options = allowedStatuses(b.status, viewer);
            const waiting = STATUS_META[b.status].waitingOn;
            return (
              <li key={b.id} className="border-b border-edge/60 last:border-b-0">
                <div className="flex items-start gap-3 px-4 py-3">
                  <span
                    className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      SEVERITY_CHIP[b.severity]
                    }`}
                  >
                    {SEVERITY_LABEL[b.severity]}
                  </span>

                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : b.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block text-sm font-medium leading-snug text-zinc-100">
                      {b.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                      <span
                        className={
                          waiting === viewer ? "text-cyan-glow" : undefined
                        }
                      >
                        {STATUS_META[b.status].label}
                      </span>
                      <span>·</span>
                      <span>{KIND_LABEL[b.kind]}</span>
                      <span>·</span>
                      <span>{AREA_TITLE[b.area as never] ?? "Other"}</span>
                      <span>·</span>
                      <span>{timeAgo(b.created_at)}</span>
                      {b.reporter_id !== userId && <span>· not yours</span>}
                    </span>
                  </button>

                  {options.length > 0 && (
                    <select
                      value={b.status}
                      disabled={busyId === b.id}
                      onChange={(e) =>
                        void setStatus(b, e.target.value as BugStatus)
                      }
                      aria-label="Status"
                      className="shrink-0 rounded-lg border border-edge bg-surface-2 px-2.5 py-1.5 text-sm text-zinc-200 focus:border-cyan-glow/50 focus:outline-none"
                    >
                      {/* The current status is always offered so the control
                          reads as "this is where it is", not "pick a change". */}
                      {Array.from(new Set([b.status, ...options])).map((s) => (
                        <option key={s} value={s}>
                          {STATUS_META[s].label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {open && (
                  <div className="space-y-4 px-4 pb-5 pl-[4.5rem] text-sm">
                    {b.steps && (
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Steps
                        </h3>
                        <p className="mt-1 whitespace-pre-wrap leading-relaxed text-zinc-300">
                          {b.steps}
                        </p>
                      </div>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      {b.expected && (
                        <div>
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                            Should happen
                          </h3>
                          <p className="mt-1 whitespace-pre-wrap leading-relaxed text-zinc-300">
                            {b.expected}
                          </p>
                        </div>
                      )}
                      {b.actual && (
                        <div>
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                            Happened instead
                          </h3>
                          <p className="mt-1 whitespace-pre-wrap leading-relaxed text-zinc-300">
                            {b.actual}
                          </p>
                        </div>
                      )}
                    </div>

                    {b.attachments?.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {b.attachments.map((att) => {
                          const src = `/api/qa/attachment?key=${encodeURIComponent(att.key)}`;
                          return (
                            <a
                              key={att.key}
                              href={src}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block overflow-hidden rounded-lg border border-edge bg-ink/40 transition-colors hover:border-cyan-glow/50"
                            >
                              {att.kind === "video" ? (
                                <span className="flex h-20 w-20 items-center justify-center text-xs text-zinc-400">
                                  Video
                                </span>
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={src}
                                  alt="Attachment"
                                  loading="lazy"
                                  className="h-20 w-20 object-cover"
                                />
                              )}
                            </a>
                          );
                        })}
                      </div>
                    )}

                    <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] text-zinc-500">
                      {b.match_id && (
                        <span>
                          <dt className="inline">Match </dt>
                          <dd className="inline">
                            <Link
                              href={`/match/${b.match_id}`}
                              className="font-mono text-cyan-glow"
                            >
                              {b.match_id.slice(0, 8)}
                            </Link>
                            {b.video_seconds !== null && (
                              <> at {formatSeconds(b.video_seconds)}</>
                            )}
                          </dd>
                        </span>
                      )}
                      {b.case_id && (
                        <span>
                          <dt className="inline">Case </dt>
                          <dd className="inline font-mono">{b.case_id}</dd>
                        </span>
                      )}
                      {b.device && (
                        <span>
                          <dt className="inline">On </dt>
                          <dd className="inline">
                            {b.device}
                            {b.browser ? `, ${b.browser}` : ""}
                            {b.viewport ? `, ${b.viewport}` : ""}
                          </dd>
                        </span>
                      )}
                      {b.url && (
                        <span>
                          <dt className="inline">Page </dt>
                          <dd className="inline font-mono">{b.url}</dd>
                        </span>
                      )}
                      {b.build_sha && (
                        <span>
                          <dt className="inline">Build </dt>
                          <dd className="inline font-mono">
                            {b.build_sha.slice(0, 8)}
                          </dd>
                        </span>
                      )}
                    </dl>

                    {isAdmin && (
                      <ResolutionNote bug={b} onSaved={load} />
                    )}
                    {!isAdmin && b.resolution && (
                      <p className="rounded-xl border border-edge bg-surface-2/40 px-4 py-3 leading-relaxed text-zinc-300">
                        {b.resolution}
                      </p>
                    )}

                    <BugThread bug={b} viewerId={userId} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The owner's note back to the tester. Saved explicitly, not on blur. */
function ResolutionNote({ bug, onSaved }: { bug: Bug; onSaved: () => void }) {
  const [text, setText] = useState(bug.resolution);
  const [saving, setSaving] = useState(false);
  const dirty = text !== bug.resolution;

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Note back
      </h3>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="What you found, or what you need from them."
        className="mt-1.5 w-full resize-y rounded-xl border border-edge bg-ink/60 px-4 py-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/50"
      />
      {dirty && (
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            const supabase = createClient();
            await supabase
              .from("qa_bugs")
              .update({ resolution: text })
              .eq("id", bug.id);
            setSaving(false);
            onSaved();
          }}
          className="mt-2 rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-cyan-glow"
        >
          {saving ? "Saving" : "Save note"}
        </button>
      )}
    </div>
  );
}
