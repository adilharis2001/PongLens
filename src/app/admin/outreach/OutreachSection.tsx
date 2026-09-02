"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  activityLine,
  buildQueues,
  CHANNEL_COPY,
  countLabel,
  dateLabel,
  KIND_COPY,
  QUEUE_COPY,
  QUEUE_ORDER,
  queueReason,
  STATUS_COPY,
  STATUSES,
  touchLine,
  type OutreachRow,
  type OutreachStatus,
  type TouchChannel,
  type TouchKind,
  type TouchRow,
} from "./outreachView";

/**
 * The outreach workspace. The queues at the top are the worklist — who to
 * contact and why — and the roster below is the full picture. Every action
 * saves the moment it is tapped; there are no save buttons except Add,
 * which creates a log entry.
 */

const STATUS_CHIP: Record<OutreachStatus, string> = {
  new: "border-cyan-glow/40 text-cyan-glow",
  contacted: "border-edge text-zinc-300",
  in_touch: "border-emerald-400/30 text-emerald-300",
  closed: "border-edge text-zinc-600",
};

export function OutreachSection() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<OutreachRow[] | null>(null);
  const [touches, setTouches] = useState<TouchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"players" | "feedback">("players");
  const [open, setOpen] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    void Promise.all([
      supabase.rpc("admin_outreach_roster"),
      supabase.rpc("admin_outreach_touches"),
    ]).then(([r, t]) => {
      if (r.error) setError(r.error.message);
      else setRows((r.data as OutreachRow[]) ?? []);
      if (t.error) setError(t.error.message);
      else setTouches((t.data as TouchRow[]) ?? []);
    });
  }, [supabase]);

  const patch = (userId: string, p: Partial<OutreachRow>) =>
    setRows(
      (rs) => rs?.map((r) => (r.user_id === userId ? { ...r, ...p } : r)) ?? rs
    );

  async function setStatus(row: OutreachRow, status: OutreachStatus) {
    if (row.status === status) return;
    const prev = row.status;
    patch(row.user_id, { status });
    const { error: e } = await supabase.rpc("admin_outreach_status_set", {
      p_user_id: row.user_id,
      p_status: status,
    });
    if (e) {
      patch(row.user_id, { status: prev });
      setError(e.message);
    }
  }

  async function setFollowUp(row: OutreachRow, on: string | null) {
    const prev = row.follow_up_on;
    patch(row.user_id, { follow_up_on: on });
    const { error: e } = await supabase.rpc("admin_outreach_follow_up_set", {
      p_user_id: row.user_id,
      p_on: on,
    });
    if (e) {
      patch(row.user_id, { follow_up_on: prev });
      setError(e.message);
    }
  }

  async function setHidden(row: OutreachRow, hidden: boolean) {
    patch(row.user_id, { hidden });
    const { error: e } = await supabase.rpc("admin_outreach_hidden_set", {
      p_user_id: row.user_id,
      p_hidden: hidden,
    });
    if (e) {
      patch(row.user_id, { hidden: !hidden });
      setError(e.message);
    }
  }

  async function addTouch(
    row: OutreachRow,
    kind: TouchKind,
    channel: TouchChannel | null,
    body: string
  ): Promise<boolean> {
    const { data, error: e } = await supabase.rpc("admin_outreach_touch_add", {
      p_user_id: row.user_id,
      p_kind: kind,
      p_channel: channel,
      p_body: body,
    });
    if (e || !data?.[0]) {
      setError(e?.message ?? "The entry did not save.");
      return false;
    }
    const added = data[0] as TouchRow;
    setTouches((ts) => [added, ...ts]);
    // Mirror the transition the database just made, so the row updates
    // without a refetch: outreach moves a fresh contact to contacted,
    // feedback moves it to in touch.
    const p: Partial<OutreachRow> = { touches: row.touches + 1 };
    if (kind === "outreach") {
      p.last_outreach_at = added.at;
      if (row.status === "new") p.status = "contacted";
    } else if (kind === "feedback") {
      p.last_feedback_at = added.at;
      if (row.status === "new" || row.status === "contacted") {
        p.status = "in_touch";
      }
    }
    patch(row.user_id, p);
    return true;
  }

  async function deleteTouch(touch: TouchRow) {
    const before = touches;
    setTouches((ts) => ts.filter((t) => t.id !== touch.id));
    const { error: e } = await supabase.rpc("admin_outreach_touch_delete", {
      p_id: touch.id,
    });
    if (e) {
      setTouches(before);
      setError(e.message);
    } else {
      const row = rows?.find((r) => r.user_id === touch.user_id);
      if (row) patch(touch.user_id, { touches: Math.max(0, row.touches - 1) });
    }
  }

  if (error && rows === null) {
    return <p className="text-sm text-red-400">{error}</p>;
  }
  if (rows === null) {
    return (
      <div className="h-40 animate-pulse rounded-2xl border border-edge bg-surface" />
    );
  }

  const visible = rows.filter((r) => !r.hidden);
  const hiddenRows = rows.filter((r) => r.hidden);
  const queues = buildQueues(rows, new Date());
  const feedback = touches.filter((t) => t.kind === "feedback");
  const nameOf = (userId: string) => {
    const row = rows.find((r) => r.user_id === userId);
    return row ? row.name || row.email : "Removed account";
  };

  const detail = (row: OutreachRow) => (
    <UserDetail
      row={row}
      touches={touches.filter((t) => t.user_id === row.user_id)}
      onStatus={(s) => setStatus(row, s)}
      onFollowUp={(on) => setFollowUp(row, on)}
      onHidden={(h) => setHidden(row, h)}
      onAdd={(kind, channel, body) => addTouch(row, kind, channel, body)}
      onDeleteTouch={deleteTouch}
    />
  );

  return (
    <>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        {(["players", "feedback"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
              tab === t
                ? "border-cyan-glow/50 text-cyan-glow"
                : "border-edge text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t === "players"
              ? countLabel(visible.length, "player")
              : `Feedback (${feedback.length})`}
          </button>
        ))}
      </div>

      {tab === "feedback" ? (
        <div className="mt-6">
          {feedback.length === 0 ? (
            <p className="text-sm text-zinc-500">No feedback logged yet.</p>
          ) : (
            <ul className="space-y-3">
              {feedback.map((t) => (
                <li
                  key={t.id}
                  className="rounded-2xl border border-edge bg-surface p-4"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium text-zinc-200">
                      {nameOf(t.user_id)}
                    </p>
                    <p className="shrink-0 text-xs text-zinc-600">
                      {dateLabel(t.at)}
                    </p>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">
                    {t.body}
                  </p>
                  <p className="mt-2 text-xs text-zinc-600">
                    {t.channel ? `${CHANNEL_COPY[t.channel]} · ` : ""}
                    logged by {t.author}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          {QUEUE_ORDER.map((key) => {
            const queued = queues[key];
            if (queued.length === 0) return null;
            return (
              <section key={key} className="mt-8">
                <h2 className="text-sm font-semibold text-zinc-200">
                  {QUEUE_COPY[key]}
                  <span className="ml-2 font-normal text-zinc-600">
                    {queued.length}
                  </span>
                </h2>
                <ul className="mt-3 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
                  {queued.map((row) => (
                    <UserRow
                      key={row.user_id}
                      row={row}
                      meta={queueReason(row, key)}
                      open={open === `${key}:${row.user_id}`}
                      onToggle={() =>
                        setOpen(
                          open === `${key}:${row.user_id}`
                            ? null
                            : `${key}:${row.user_id}`
                        )
                      }
                    >
                      {detail(row)}
                    </UserRow>
                  ))}
                </ul>
              </section>
            );
          })}

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-zinc-200">Everyone</h2>
            {visible.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">No real players yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
                {visible.map((row) => (
                  <UserRow
                    key={row.user_id}
                    row={row}
                    meta={`Signed up ${dateLabel(row.signed_up)} · ${activityLine(row)}`}
                    open={open === `all:${row.user_id}`}
                    onToggle={() =>
                      setOpen(
                        open === `all:${row.user_id}`
                          ? null
                          : `all:${row.user_id}`
                      )
                    }
                  >
                    {detail(row)}
                  </UserRow>
                ))}
              </ul>
            )}
          </section>

          {hiddenRows.length > 0 && (
            <section className="mt-8">
              <button
                onClick={() => setShowHidden(!showHidden)}
                className="text-sm text-zinc-500 transition-colors hover:text-zinc-300"
              >
                {showHidden ? "Hide" : "Show"} the accounts marked not real (
                {hiddenRows.length})
              </button>
              {showHidden && (
                <ul className="mt-3 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface opacity-70">
                  {hiddenRows.map((row) => (
                    <li
                      key={row.user_id}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-zinc-300">
                          {row.name || row.email}
                        </p>
                        <p className="truncate text-xs text-zinc-600">
                          {row.email}
                        </p>
                      </div>
                      <button
                        onClick={() => setHidden(row, false)}
                        className="shrink-0 rounded-full border border-edge px-3 py-1 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/40 hover:text-cyan-glow"
                      >
                        Treat as real
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}

function UserRow({
  row,
  meta,
  open,
  onToggle,
  children,
}: {
  row: OutreachRow;
  meta: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <li>
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 text-left transition-colors hover:bg-surface-2/40"
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-medium text-zinc-200">
            {row.name || row.email}
          </p>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${STATUS_CHIP[row.status]}`}
          >
            {STATUS_COPY[row.status]}
          </span>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-xs text-zinc-500">{meta}</p>
          <p className="shrink-0 text-xs text-zinc-600">{touchLine(row)}</p>
        </div>
      </button>
      {open && children}
    </li>
  );
}

function UserDetail({
  row,
  touches,
  onStatus,
  onFollowUp,
  onHidden,
  onAdd,
  onDeleteTouch,
}: {
  row: OutreachRow;
  touches: TouchRow[];
  onStatus: (s: OutreachStatus) => void;
  onFollowUp: (on: string | null) => void;
  onHidden: (h: boolean) => void;
  onAdd: (
    kind: TouchKind,
    channel: TouchChannel | null,
    body: string
  ) => Promise<boolean>;
  onDeleteTouch: (t: TouchRow) => void;
}) {
  const [kind, setKind] = useState<TouchKind>("outreach");
  const [channel, setChannel] = useState<TouchChannel | null>(null);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  // Feedback is a quote of what the user said; an empty one means nothing.
  const canAdd = !saving && (kind !== "feedback" || body.trim().length > 0);

  async function submit() {
    if (!canAdd) return;
    setSaving(true);
    const ok = await onAdd(kind, channel, body.trim());
    setSaving(false);
    if (ok) setBody("");
  }

  const uploadsFacts = [countLabel(row.matches, "upload")];
  if (row.matches_scored > 0) uploadsFacts.push(`${row.matches_scored} scored`);
  if (row.matches_failed > 0) uploadsFacts.push(`${row.matches_failed} failed`);

  const inAWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  return (
    <div className="border-t border-edge/60 bg-surface-2/20 px-4 py-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <Fact label="Email" value={row.email} />
        <Fact label="Signed up" value={dateLabel(row.signed_up)} />
        <Fact
          label="Last seen"
          value={row.last_seen ? dateLabel(row.last_seen) : "Never"}
        />
        <Fact label="Uploads" value={uploadsFacts.join(", ")} />
        <Fact
          label="Last upload"
          value={row.last_upload_at ? dateLabel(row.last_upload_at) : "None"}
        />
        <Fact label="Points scored" value={String(row.points)} />
        <Fact label="Notes" value={String(row.notes)} />
        <Fact label="Journal" value={String(row.journal_entries)} />
        <Fact
          label="Coach side"
          value={row.is_coach ? "Set up" : "Not set up"}
        />
      </dl>

      <Link
        href={`/admin/players/${row.user_id}`}
        className="mt-3 inline-block text-sm text-cyan-glow hover:underline"
      >
        Open in Players
      </Link>

      <div className="mt-4">
        <p className="text-xs text-zinc-500">Status</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => onStatus(s)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                row.status === s
                  ? "border-cyan-glow/50 text-cyan-glow"
                  : "border-edge text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {STATUS_COPY[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs text-zinc-500">Follow up</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={row.follow_up_on ?? ""}
            onChange={(e) => onFollowUp(e.target.value || null)}
            className="rounded-full border border-edge bg-surface-2/40 px-3 py-1 text-sm text-zinc-100 outline-none [color-scheme:dark] focus:border-cyan-glow/50"
          />
          {row.follow_up_on ? (
            <button
              onClick={() => onFollowUp(null)}
              className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-400 transition-colors hover:border-amber-400/40 hover:text-amber-300"
            >
              Clear
            </button>
          ) : (
            <button
              onClick={() => onFollowUp(inAWeek)}
              className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
            >
              In a week
            </button>
          )}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs text-zinc-500">Log what happened</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(Object.keys(KIND_COPY) as TouchKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                kind === k
                  ? "border-cyan-glow/50 text-cyan-glow"
                  : "border-edge text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {KIND_COPY[k]}
            </button>
          ))}
        </div>
        {kind !== "note" && (
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(CHANNEL_COPY) as TouchChannel[]).map((c) => (
              <button
                key={c}
                onClick={() => setChannel(channel === c ? null : c)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  channel === c
                    ? "border-zinc-400 text-zinc-200"
                    : "border-edge text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {CHANNEL_COPY[c]}
              </button>
            ))}
          </div>
        )}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder={
            kind === "feedback"
              ? "What they said, in their words"
              : kind === "outreach"
                ? "What you sent, if worth keeping"
                : "Anything worth remembering"
          }
          className="mt-2 w-full resize-y rounded-xl border border-edge bg-surface-2/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/50"
        />
        <button
          onClick={() => void submit()}
          disabled={!canAdd}
          className="mt-2 rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-200 transition-colors enabled:hover:border-cyan-glow/40 enabled:hover:text-cyan-glow disabled:text-zinc-600"
        >
          {saving ? "Saving…" : "Add to the log"}
        </button>
      </div>

      {touches.length > 0 && (
        <ul className="mt-4 space-y-2">
          {touches.map((t) => (
            <li
              key={t.id}
              className="rounded-xl border border-edge/60 bg-surface px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-xs text-zinc-400">
                  {KIND_COPY[t.kind]}
                  {t.channel ? ` · ${CHANNEL_COPY[t.channel]}` : ""}
                  {` · ${dateLabel(t.at)} · ${t.author}`}
                </p>
                <button
                  onClick={() => onDeleteTouch(t)}
                  className="shrink-0 text-sm text-zinc-400 transition-colors hover:text-amber-300"
                >
                  Remove
                </button>
              </div>
              {t.body && (
                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">
                  {t.body}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {!row.hidden && (
        <button
          onClick={() => onHidden(true)}
          className="mt-4 rounded-full border border-edge px-3 py-1 text-sm text-zinc-400 transition-colors hover:border-amber-400/40 hover:text-amber-300"
        >
          Hide from outreach
        </button>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="truncate text-zinc-200">{value}</dd>
    </div>
  );
}
