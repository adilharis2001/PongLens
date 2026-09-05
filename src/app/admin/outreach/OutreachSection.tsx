"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  activityLine,
  buildPersonQueues,
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
  type PlayerKind,
  type OutreachStatus,
  type PersonRow,
  type TouchChannel,
  type TouchKind,
  type TouchRow,
} from "./outreachView";

/**
 * The outreach workspace. The queues at the top are the worklist — who to
 * contact and why — and the rosters below are the full picture: every real
 * account, plus the people Anton added by hand. Every action saves the
 * moment it is tapped; the only submit buttons create log entries.
 */

const STATUS_CHIP: Record<OutreachStatus, string> = {
  new: "border-cyan-glow/40 text-cyan-glow",
  contacted: "border-edge text-zinc-300",
  in_touch: "border-emerald-400/30 text-emerald-300",
  closed: "border-edge text-zinc-600",
};

const INPUT_CLS =
  "rounded-full border border-edge bg-surface-2/40 px-3 py-1 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-glow/50";

export function OutreachSection() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<OutreachRow[] | null>(null);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [touches, setTouches] = useState<TouchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"players" | "feedback">("players");
  /** Real / team / test, shared with the Players page (176). Opens on
   *  Real: this queue is a list of people to write to, and our own
   *  accounts were sitting in it. */
  const [kindFilter, setKindFilter] = useState<PlayerKind | "all">("real");
  const [open, setOpen] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    void Promise.all([
      supabase.rpc("admin_outreach_roster"),
      supabase.rpc("admin_outreach_people"),
      supabase.rpc("admin_outreach_touches"),
    ]).then(([r, p, t]) => {
      if (r.error) setError(r.error.message);
      else setRows((r.data as OutreachRow[]) ?? []);
      if (p.error) setError(p.error.message);
      else setPeople((p.data as PersonRow[]) ?? []);
      if (t.error) setError(t.error.message);
      else setTouches((t.data as TouchRow[]) ?? []);
    });
  }, [supabase]);

  const patch = (userId: string, p: Partial<OutreachRow>) =>
    setRows(
      (rs) => rs?.map((r) => (r.user_id === userId ? { ...r, ...p } : r)) ?? rs
    );
  const patchPerson = (id: string, p: Partial<PersonRow>) =>
    setPeople((ps) => ps.map((x) => (x.id === id ? { ...x, ...p } : x)));

  // Both the user and person actions run the same optimistic shape: apply
  // locally, call the RPC, revert and surface the message on error.
  async function act(
    apply: () => void,
    revert: () => void,
    // Supabase's rpc() builder is thenable rather than a real Promise.
    call: () => PromiseLike<{ error: { message: string } | null }>
  ) {
    apply();
    const { error: e } = await call();
    if (e) {
      revert();
      setError(e.message);
    }
  }

  const setStatus = (row: OutreachRow, status: OutreachStatus) =>
    row.status === status
      ? Promise.resolve()
      : act(
          () => patch(row.user_id, { status }),
          () => patch(row.user_id, { status: row.status }),
          () =>
            supabase.rpc("admin_outreach_status_set", {
              p_user_id: row.user_id,
              p_status: status,
            })
        );

  /** The same control the Players page has, writing the same row, so
   *  marking somebody here moves them there and the other way round. */
  const setKind = (row: OutreachRow, kind: PlayerKind) =>
    row.kind === kind
      ? Promise.resolve()
      : act(
          () => patch(row.user_id, { kind }),
          () => patch(row.user_id, { kind: row.kind }),
          () =>
            supabase.rpc("admin_player_kind_set", {
              p_user_id: row.user_id,
              p_kind: kind,
            })
        );

  const setFollowUp = (row: OutreachRow, on: string | null) =>
    act(
      () => patch(row.user_id, { follow_up_on: on }),
      () => patch(row.user_id, { follow_up_on: row.follow_up_on }),
      () =>
        supabase.rpc("admin_outreach_follow_up_set", {
          p_user_id: row.user_id,
          p_on: on,
        })
    );

  const setHidden = (row: OutreachRow, hidden: boolean) =>
    act(
      () => patch(row.user_id, { hidden }),
      () => patch(row.user_id, { hidden: !hidden }),
      () =>
        supabase.rpc("admin_outreach_hidden_set", {
          p_user_id: row.user_id,
          p_hidden: hidden,
        })
    );

  const setPersonStatus = (p: PersonRow, status: OutreachStatus) =>
    p.status === status
      ? Promise.resolve()
      : act(
          () => patchPerson(p.id, { status }),
          () => patchPerson(p.id, { status: p.status }),
          () =>
            supabase.rpc("admin_outreach_person_status_set", {
              p_id: p.id,
              p_status: status,
            })
        );

  const setPersonFollowUp = (p: PersonRow, on: string | null) =>
    act(
      () => patchPerson(p.id, { follow_up_on: on }),
      () => patchPerson(p.id, { follow_up_on: p.follow_up_on }),
      () =>
        supabase.rpc("admin_outreach_person_follow_up_set", {
          p_id: p.id,
          p_on: on,
        })
    );

  /** Mirror the transition the database makes, so no refetch is needed. */
  function bumpAfterTouch(
    subject: { status: OutreachStatus; touches: number },
    kind: TouchKind,
    at: string
  ): {
    touches: number;
    status?: OutreachStatus;
    last_outreach_at?: string;
    last_feedback_at?: string;
  } {
    const p: ReturnType<typeof bumpAfterTouch> = {
      touches: subject.touches + 1,
    };
    if (kind === "outreach") {
      p.last_outreach_at = at;
      if (subject.status === "new") p.status = "contacted";
    } else if (kind === "feedback") {
      p.last_feedback_at = at;
      if (subject.status === "new" || subject.status === "contacted") {
        p.status = "in_touch";
      }
    }
    return p;
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
    patch(row.user_id, bumpAfterTouch(row, kind, added.at));
    return true;
  }

  async function addPersonTouch(
    p: PersonRow,
    kind: TouchKind,
    channel: TouchChannel | null,
    body: string
  ): Promise<boolean> {
    const { data, error: e } = await supabase.rpc(
      "admin_outreach_person_touch_add",
      { p_id: p.id, p_kind: kind, p_channel: channel, p_body: body }
    );
    if (e || !data?.[0]) {
      setError(e?.message ?? "The entry did not save.");
      return false;
    }
    const added = data[0] as TouchRow;
    setTouches((ts) => [added, ...ts]);
    patchPerson(p.id, bumpAfterTouch(p, kind, added.at));
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
      return;
    }
    if (touch.user_id) {
      const row = rows?.find((r) => r.user_id === touch.user_id);
      if (row) patch(touch.user_id, { touches: Math.max(0, row.touches - 1) });
    } else if (touch.person_id) {
      const p = people.find((x) => x.id === touch.person_id);
      if (p) patchPerson(p.id, { touches: Math.max(0, p.touches - 1) });
    }
  }

  async function addPerson(name: string, email: string): Promise<boolean> {
    const { data, error: e } = await supabase.rpc(
      "admin_outreach_person_add",
      { p_name: name, p_email: email || null }
    );
    if (e || !data?.[0]) {
      setError(e?.message ?? "The person did not save.");
      return false;
    }
    const added = data[0] as PersonRow;
    setPeople((ps) => [
      {
        ...added,
        last_outreach_at: null,
        last_feedback_at: null,
        touches: 0,
      },
      ...ps,
    ]);
    return true;
  }

  const editPerson = (p: PersonRow, name: string, email: string) =>
    act(
      () => patchPerson(p.id, { name, email: email || null }),
      () => patchPerson(p.id, { name: p.name, email: p.email }),
      () =>
        supabase.rpc("admin_outreach_person_edit", {
          p_id: p.id,
          p_name: name,
          p_email: email || null,
        })
    );

  async function deletePerson(p: PersonRow) {
    const beforePeople = people;
    const beforeTouches = touches;
    setPeople((ps) => ps.filter((x) => x.id !== p.id));
    setTouches((ts) => ts.filter((t) => t.person_id !== p.id));
    setOpen(null);
    const { error: e } = await supabase.rpc("admin_outreach_person_delete", {
      p_id: p.id,
    });
    if (e) {
      setPeople(beforePeople);
      setTouches(beforeTouches);
      setError(e.message);
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

  const kindCounts: Record<string, number> = {
    real: 0, team: 0, test: 0, all: rows.length,
  };
  for (const r of rows) kindCounts[r.kind] = (kindCounts[r.kind] ?? 0) + 1;
  // Applied before the queues are built, so a filtered-out account cannot
  // sit in "to contact" and inflate the section counts.
  const ofKind =
    kindFilter === "all" ? rows : rows.filter((r) => r.kind === kindFilter);

  const visible = ofKind.filter((r) => !r.hidden);
  const hiddenRows = ofKind.filter((r) => r.hidden);
  const now = new Date();
  const queues = buildQueues(ofKind, now);
  const personQueues = buildPersonQueues(people, now);
  const feedback = touches.filter((t) => t.kind === "feedback");
  const nameOf = (t: TouchRow) => {
    if (t.user_id) {
      const row = rows.find((r) => r.user_id === t.user_id);
      return row ? row.name || row.email : "Removed account";
    }
    const p = people.find((x) => x.id === t.person_id);
    return p ? p.name : "Removed entry";
  };

  const toggle = (id: string) => setOpen(open === id ? null : id);

  const userItem = (row: OutreachRow, section: string, meta: string) => (
    <ExpandableRow
      key={`${section}:${row.user_id}`}
      title={row.name || row.email}
      status={row.status}
      meta={meta}
      side={touchLine(row)}
      open={open === `${section}:${row.user_id}`}
      onToggle={() => toggle(`${section}:${row.user_id}`)}
    >
      <UserDetail
        row={row}
        touches={touches.filter((t) => t.user_id === row.user_id)}
        onStatus={(s) => void setStatus(row, s)}
        onFollowUp={(on) => void setFollowUp(row, on)}
        onHidden={(h) => void setHidden(row, h)}
        onKind={(k) => void setKind(row, k)}
        onAdd={(kind, channel, body) => addTouch(row, kind, channel, body)}
        onDeleteTouch={deleteTouch}
      />
    </ExpandableRow>
  );

  const personItem = (p: PersonRow, section: string, meta: string) => (
    <ExpandableRow
      key={`${section}:p:${p.id}`}
      title={p.name}
      status={p.status}
      meta={meta}
      side={touchLine(p)}
      open={open === `${section}:p:${p.id}`}
      onToggle={() => toggle(`${section}:p:${p.id}`)}
    >
      <PersonDetail
        person={p}
        touches={touches.filter((t) => t.person_id === p.id)}
        onStatus={(s) => void setPersonStatus(p, s)}
        onFollowUp={(on) => void setPersonFollowUp(p, on)}
        onEdit={(name, email) => void editPerson(p, name, email)}
        onDelete={() => void deletePerson(p)}
        onAdd={(kind, channel, body) => addPersonTouch(p, kind, channel, body)}
        onDeleteTouch={deleteTouch}
      />
    </ExpandableRow>
  );

  return (
    <>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                ? countLabel(visible.length + people.length, "player")
                : `Feedback (${feedback.length})`}
            </button>
          ))}
        </div>

        {/* The same four the Players page offers, on the same rule, so a
            person marked in one place is marked in both. Only on the
            players tab: feedback is logged against a person, and a note
            somebody left does not stop being feedback because their
            account turned out to be ours. */}
        {tab === "players" && (
          <div className="flex gap-1 overflow-x-auto">
            {(["real", "team", "test", "all"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKindFilter(k)}
                aria-pressed={kindFilter === k}
                className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  kindFilter === k
                    ? "bg-surface-2 text-white"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {k === "all" ? "All" : k[0].toUpperCase() + k.slice(1)}
                <span className="ml-1.5 tabular-nums text-zinc-600">
                  {kindCounts[k] ?? 0}
                </span>
              </button>
            ))}
          </div>
        )}
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
                      {nameOf(t)}
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
            const queuedUsers = queues[key];
            const queuedPeople = personQueues[key];
            const total = queuedUsers.length + queuedPeople.length;
            if (total === 0) return null;
            return (
              <section key={key} className="mt-8">
                <h2 className="text-sm font-semibold text-zinc-200">
                  {QUEUE_COPY[key]}
                  <span className="ml-2 font-normal text-zinc-600">
                    {total}
                  </span>
                </h2>
                <ul className="mt-3 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
                  {queuedUsers.map((row) =>
                    userItem(row, key, queueReason(row, key))
                  )}
                  {queuedPeople.map((p) =>
                    personItem(
                      p,
                      key,
                      key === "due"
                        ? `Follow up planned for ${dateLabel(p.follow_up_on)}`
                        : `Added by hand ${dateLabel(p.created_at)}`
                    )
                  )}
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
                {visible.map((row) =>
                  userItem(
                    row,
                    "all",
                    `Signed up ${dateLabel(row.signed_up)} · ${activityLine(row)}`
                  )
                )}
              </ul>
            )}
          </section>

          <AddedByHand
            people={people}
            renderPerson={(p) =>
              personItem(
                p,
                "hand",
                `Added ${dateLabel(p.created_at)}${p.email ? ` · ${p.email}` : ""}`
              )
            }
            onAdd={addPerson}
          />

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
                        onClick={() => void setHidden(row, false)}
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

/** The section for people Anton tracks who have no account yet. */
function AddedByHand({
  people,
  renderPerson,
  onAdd,
}: {
  people: PersonRow[];
  renderPerson: (p: PersonRow) => React.ReactNode;
  onAdd: (name: string, email: string) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    const ok = await onAdd(name.trim(), email.trim());
    setSaving(false);
    if (ok) {
      setName("");
      setEmail("");
      setAdding(false);
    }
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-200">Added by hand</h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/40 hover:text-cyan-glow"
          >
            Add someone
          </button>
        )}
      </div>
      {adding && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-edge bg-surface p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            autoFocus
            className={INPUT_CLS}
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email, if you have it"
            type="email"
            className={INPUT_CLS}
          />
          <button
            onClick={() => void submit()}
            disabled={!name.trim() || saving}
            className="rounded-full border border-edge px-4 py-1 text-sm text-zinc-200 transition-colors enabled:hover:border-cyan-glow/40 enabled:hover:text-cyan-glow disabled:text-zinc-600"
          >
            {saving ? "Saving…" : "Add"}
          </button>
          <button
            onClick={() => setAdding(false)}
            className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
          >
            Cancel
          </button>
        </div>
      )}
      {people.length === 0 ? (
        !adding && (
          <p className="mt-3 text-sm text-zinc-500">No one added yet.</p>
        )
      ) : (
        <ul className="mt-3 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
          {people.map(renderPerson)}
        </ul>
      )}
    </section>
  );
}

function ExpandableRow({
  title,
  status,
  meta,
  side,
  open,
  onToggle,
  children,
}: {
  title: string;
  status: OutreachStatus;
  meta: string;
  side: string;
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
            {title}
          </p>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${STATUS_CHIP[status]}`}
          >
            {STATUS_COPY[status]}
          </span>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-xs text-zinc-500">{meta}</p>
          <p className="shrink-0 text-xs text-zinc-600">{side}</p>
        </div>
      </button>
      {open && children}
    </li>
  );
}

/** Status pills, follow-up date, the add-to-log form and the log itself —
 *  identical for platform users and hand-added people. */
function ContactControls({
  status,
  followUpOn,
  touches,
  onStatus,
  onFollowUp,
  onAdd,
  onDeleteTouch,
}: {
  status: OutreachStatus;
  followUpOn: string | null;
  touches: TouchRow[];
  onStatus: (s: OutreachStatus) => void;
  onFollowUp: (on: string | null) => void;
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

  // Feedback is a quote of what the person said; an empty one means nothing.
  const canAdd = !saving && (kind !== "feedback" || body.trim().length > 0);

  async function submit() {
    if (!canAdd) return;
    setSaving(true);
    const ok = await onAdd(kind, channel, body.trim());
    setSaving(false);
    if (ok) setBody("");
  }

  const inAWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  return (
    <>
      <div className="mt-4">
        <p className="text-xs text-zinc-500">Status</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => onStatus(s)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                status === s
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
            value={followUpOn ?? ""}
            onChange={(e) => onFollowUp(e.target.value || null)}
            className={`${INPUT_CLS} [color-scheme:dark]`}
          />
          {followUpOn ? (
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
    </>
  );
}

function UserDetail({
  row,
  touches,
  onStatus,
  onFollowUp,
  onHidden,
  onKind,
  onAdd,
  onDeleteTouch,
}: {
  row: OutreachRow;
  touches: TouchRow[];
  onStatus: (s: OutreachStatus) => void;
  onFollowUp: (on: string | null) => void;
  onHidden: (h: boolean) => void;
  onKind: (k: PlayerKind) => void;
  onAdd: (
    kind: TouchKind,
    channel: TouchChannel | null,
    body: string
  ) => Promise<boolean>;
  onDeleteTouch: (t: TouchRow) => void;
}) {
  const uploadsFacts = [countLabel(row.matches, "upload")];
  if (row.matches_scored > 0) uploadsFacts.push(`${row.matches_scored} scored`);
  if (row.matches_failed > 0) uploadsFacts.push(`${row.matches_failed} failed`);

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

      <ContactControls
        status={row.status}
        followUpOn={row.follow_up_on}
        touches={touches}
        onStatus={onStatus}
        onFollowUp={onFollowUp}
        onAdd={onAdd}
        onDeleteTouch={onDeleteTouch}
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {/* Marking somebody writes the same row the Players page reads.
            Hiding is different and stays: it takes ONE person out of the
            queue without saying they are not a user. */}
        <label className="flex items-center gap-2 text-sm text-zinc-500">
          Kind
          <select
            value={row.kind}
            onChange={(e) => onKind(e.target.value as PlayerKind)}
            className="rounded-full border border-edge bg-surface-2 px-2.5 py-1 text-xs text-zinc-300 focus:border-cyan-glow/60 focus:outline-none"
          >
            <option value="real">Real</option>
            <option value="team">Team</option>
            <option value="test">Test</option>
          </select>
        </label>
        {!row.hidden && (
          <button
            onClick={() => onHidden(true)}
            className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-400 transition-colors hover:border-amber-400/40 hover:text-amber-300"
          >
            Hide from outreach
          </button>
        )}
      </div>
    </div>
  );
}

function PersonDetail({
  person,
  touches,
  onStatus,
  onFollowUp,
  onEdit,
  onDelete,
  onAdd,
  onDeleteTouch,
}: {
  person: PersonRow;
  touches: TouchRow[];
  onStatus: (s: OutreachStatus) => void;
  onFollowUp: (on: string | null) => void;
  onEdit: (name: string, email: string) => void;
  onDelete: () => void;
  onAdd: (
    kind: TouchKind,
    channel: TouchChannel | null,
    body: string
  ) => Promise<boolean>;
  onDeleteTouch: (t: TouchRow) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email ?? "");

  return (
    <div className="border-t border-edge/60 bg-surface-2/20 px-4 py-4">
      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className={INPUT_CLS}
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email, if you have it"
            type="email"
            className={INPUT_CLS}
          />
          <button
            onClick={() => {
              if (!name.trim()) return;
              onEdit(name.trim(), email.trim());
              setEditing(false);
            }}
            disabled={!name.trim()}
            className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-200 transition-colors enabled:hover:border-cyan-glow/40 enabled:hover:text-cyan-glow disabled:text-zinc-600"
          >
            Save
          </button>
          <button
            onClick={() => {
              setName(person.name);
              setEmail(person.email ?? "");
              setEditing(false);
            }}
            className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-sm text-zinc-300">
            {person.email ?? "No email yet"}
          </p>
          <p className="text-xs text-zinc-600">
            Added {dateLabel(person.created_at)} by {person.created_by}
          </p>
          <button
            onClick={() => setEditing(true)}
            className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
          >
            Edit
          </button>
        </div>
      )}

      <ContactControls
        status={person.status}
        followUpOn={person.follow_up_on}
        touches={touches}
        onStatus={onStatus}
        onFollowUp={onFollowUp}
        onAdd={onAdd}
        onDeleteTouch={onDeleteTouch}
      />

      <button
        onClick={onDelete}
        className="mt-4 rounded-full border border-edge px-3 py-1 text-sm text-zinc-400 transition-colors hover:border-amber-400/40 hover:text-amber-300"
      >
        Remove this person
      </button>
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
