"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BetaDetail, OUTREACH_ACTION } from "./BetaDetail";
import {
  unifyOutreach,
  unifiedQueueFor,
  invitationLabel,
  effectiveInvitationState,
  outreachKind,
  pendingOutreachInvitations,
  type BetaOutreachRow,
  type UnifiedOutreachRow,
} from "./betaOutreachView";
import {
  PLAYER_INTERESTS,
  COACH_INTERESTS,
  FEEDBACK_OPTIONS,
} from "@/lib/iosBeta/questionnaire";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  activityLine,
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
  const [betas, setBetas] = useState<BetaOutreachRow[]>([]);
  const [touches, setTouches] = useState<TouchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"players" | "feedback">("players");
  const [kindFilter, setKindFilter] = useState<PlayerKind | "all">("real");
  const [betaOnly, setBetaOnly] = useState(false);
  const [roleFilter, setRoleFilter] = useState("");
  const [interestFilter, setInterestFilter] = useState("");
  const [inviteFilter, setInviteFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const refreshedInvites = useRef(new Map<string, number>());
  const refreshSequence = useRef(0);

  const load = useCallback(async () => {
    const results = await Promise.all([
      supabase.rpc("admin_outreach_roster"),
      supabase.rpc("admin_outreach_people"),
      supabase.rpc("admin_outreach_touches"),
      supabase.rpc("admin_beta_outreach_roster"),
    ]);
    const failure = results.find((r) => r.error);
    if (failure?.error)
      throw new Error("The outreach list could not be loaded. Please refresh.");
    setRows(results[0].data ?? []);
    setPeople(results[1].data ?? []);
    setTouches(results[2].data ?? []);
    setBetas(results[3].data ?? []);
    return (results[3].data ?? []) as BetaOutreachRow[];
  }, [supabase]);

  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const id = new URLSearchParams(window.location.search).get("beta");
    if (id) {
      setBetaOnly(true);
      setKindFilter("all");
      setShowHidden(true);
      setOpen("beta-link:" + id);
    }
  }, [load]);

  const unified = useMemo(
    () => unifyOutreach(rows ?? [], people, betas, touches),
    [rows, people, betas, touches],
  );
  const now = new Date();
  const filtered = unified.filter(
    (r) =>
      (!betaOnly || !!r.beta) &&
      (!betaOnly || !roleFilter || r.beta?.role === roleFilter) &&
      (!betaOnly ||
        !interestFilter ||
        r.beta?.interests.includes(interestFilter)) &&
      (!betaOnly ||
        !inviteFilter ||
        (r.beta && effectiveInvitationState(r.beta, now) === inviteFilter)) &&
      (!betaOnly ||
        !channelFilter ||
        r.beta?.feedback_channels.includes(channelFilter)),
  );
  const selected = filtered.filter(r => kindFilter === "all" || outreachKind(r) === kindFilter);
  const visible = selected.filter((r) => !r.account?.hidden);
  const hidden = selected.filter((r) => r.account?.hidden);
  const pending = pendingOutreachInvitations(filtered, kindFilter);
  const counted = betaOnly ? unified.filter(r => r.beta) : unified;
  const kindCounts: Record<string, number> = {
    real: 0,
    team: 0,
    test: 0,
    all: counted.length,
  };
  for (const r of counted) kindCounts[outreachKind(r)]++;

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      // Old quarantined rows can remain pending indefinitely. Rotate by last
      // attempt, preserving deadline order for ties and the ten-request bound.
      const opened = pending.find(
        (r) =>
          open === "beta-link:" + r.beta!.id ||
          ["pending", "everyone", ...QUEUE_ORDER].some(
            (section) => open === section + ":" + r.key,
          ),
      );
      const batch = [...pending].sort(
        (a, b) =>
          (refreshedInvites.current.get(a.beta!.id) ?? 0) -
          (refreshedInvites.current.get(b.beta!.id) ?? 0),
      );
      const ids = [
        ...new Set([
          ...(opened ? [opened.beta!.id] : []),
          ...batch.map((r) => r.beta!.id),
        ]),
      ].slice(0, 10);
      // Advance even on uncertainty, so another click can reach later rows.
      const sequence = ++refreshSequence.current;
      ids.forEach((id) => refreshedInvites.current.set(id, sequence));
      if (ids.length) {
        const response = await fetch("/api/admin/ios-beta/reconcile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok)
          setError(
            "Some invitation statuses could not be confirmed. Please refresh again.",
          );
      }
      await load();
    } catch {
      setError("The outreach list could not be refreshed. Please try again.");
    } finally {
      setRefreshing(false);
    }
  }

  async function mutate(
    rpc: string,
    args: Record<string, unknown>,
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const result = await supabase.rpc(rpc, args);
      if (result.error)
        throw new Error("The change did not save. Please try again.");
      await load();
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The change did not save. Please try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  function action(
    row: UnifiedOutreachRow,
    action: string,
    value: string | null = null,
    on: string | null = null,
    channel: string | null = null,
    body = "",
  ) {
    const [subject, id] = row.key.split(":");
    return mutate("admin_outreach_act", {
      p_subject: subject,
      p_id: id,
      p_action: action,
      p_value: value,
      p_on: on,
      p_channel: channel,
      p_body: body,
    });
  }
  const deleteTouch = (t: TouchRow) =>
    void mutate("admin_outreach_touch_delete", { p_id: t.id });
  const historySummary = (r: UnifiedOutreachRow) =>
    touchLine({
      last_outreach_at:
        r.touches.find((t) => t.kind === "outreach")?.at ?? null,
      last_feedback_at:
        r.touches.find((t) => t.kind === "feedback")?.at ?? null,
    });
  const renderPerson = (
    r: UnifiedOutreachRow,
    section: string,
    meta?: string,
  ) => {
    const opened =
      open === section + ":" + r.key ||
      ((section === "everyone" || section === "hidden") &&
        open === "beta-link:" + r.beta?.id);
    const controls = {
      touches: r.touches,
      onStatus: (s: OutreachStatus) => void action(r, "status", s),
      onFollowUp: (on: string | null) => void action(r, "follow_up", null, on),
      onAdd: (kind: TouchKind, channel: TouchChannel | null, body: string) =>
        action(r, "touch", kind, null, channel, body),
      onDeleteTouch: deleteTouch,
    };
    const extra = (
      <>
        {r.ambiguous && (
          <p className="mt-3 text-sm text-amber-300">
            More than one manual contact uses this email.
          </p>
        )}
        {r.followUps.length > 1 && (
          <p className="mt-3 text-sm text-zinc-400">
            {r.followUps
              .map((f) => f.source + ": " + dateLabel(f.on))
              .join(" · ")}
          </p>
        )}
        {r.people
          .filter((p) => p.status !== r.status)
          .map((p) => (
            <p key={p.id} className="mt-2 text-sm text-zinc-400">
              Manual contact: {STATUS_COPY[p.status]}
            </p>
          ))}
        {r.beta && r.beta.status !== r.status && (
          <p className="mt-2 text-sm text-zinc-400">
            Beta contact: {STATUS_COPY[r.beta.status]}
          </p>
        )}
        {r.beta && (
          <BetaDetail
            beta={r.beta}
            onRefresh={async () => {
              await load();
            }}
            onCorrection={(role, interests, choice, channels, note) =>
              mutate("admin_beta_feedback_correct", {
                p_id: r.beta!.id,
                p_role: role,
                p_interests: interests,
                p_choice: choice,
                p_channels: channels,
                p_note: note,
              })
            }
          />
        )}
      </>
    );
    return (
      <ExpandableRow
        key={section + ":" + r.key}
        title={r.beta?.email ?? r.name}
        identity={r.beta ? (r.name !== r.beta.email ? r.name : null) : (r.email !== r.name ? r.email : null)}
        status={r.status}
        meta={
          meta ??
          (r.beta && (betaOnly || section === "pending")
            ? "iPhone beta · " + invitationLabel(r.beta, now) + (outreachKind(r) === "team" ? " · Team" : outreachKind(r) === "test" ? " · Test" : "")
            : r.account
            ? "Signed up " +
              dateLabel(r.account.signed_up) +
              " · " +
              activityLine(r.account)
            : r.beta
              ? "iPhone beta · " + invitationLabel(r.beta, now)
              : "Added " + dateLabel(r.person!.created_at))
        }
        side={historySummary(r)}
        open={opened}
        onToggle={() => setOpen(opened ? null : section + ":" + r.key)}
      >
        <fieldset disabled={busy} className="min-w-0">
          {r.account ? (
            <UserDetail
              {...controls}
              extra={extra}
              row={{
                ...r.account,
                status: r.status,
                follow_up_on: r.follow_up_on,
              }}
              onHidden={(h) =>
                void mutate("admin_outreach_hidden_set", {
                  p_user_id: r.account!.user_id,
                  p_hidden: h,
                })
              }
              onKind={(k) =>
                void mutate("admin_player_kind_set", {
                  p_user_id: r.account!.user_id,
                  p_kind: k,
                })
              }
            />
          ) : r.person ? (
            <PersonDetail
              {...controls}
              extra={extra}
              person={{
                ...r.person,
                status: r.status,
                follow_up_on: r.follow_up_on,
              }}
              onEdit={(name, email) =>
                void mutate("admin_outreach_person_edit", {
                  p_id: r.person!.id,
                  p_name: name,
                  p_email: email || null,
                })
              }
              onDelete={() =>
                void mutate("admin_outreach_person_delete", {
                  p_id: r.person!.id,
                })
              }
            />
          ) : (
            <div className="border-t border-edge/60 bg-surface-2/20 px-4 py-4">
              {extra}
              <ContactControls
                {...controls}
                status={r.status}
                followUpOn={r.follow_up_on}
              />
            </div>
          )}
        </fieldset>
      </ExpandableRow>
    );
  };
  const list = (items: UnifiedOutreachRow[], section: string) => (
    <ul className="mt-3 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
      {items.map((r) =>
        renderPerson(
          r,
          section,
          r.account &&
            QUEUE_ORDER.includes(section as (typeof QUEUE_ORDER)[number])
            ? queueReason(
                {
                  ...r.account,
                  status: r.status,
                  follow_up_on: r.follow_up_on,
                },
                section as (typeof QUEUE_ORDER)[number],
              )
            : undefined,
        ),
      )}
    </ul>
  );

  if (rows === null)
    return error ? (
      <p role="alert" className="text-sm text-red-400">
        {error}
      </p>
    ) : (
      <div className="h-40 animate-pulse rounded-2xl border border-edge bg-surface" />
    );
  const feedback = touches.filter((t) => t.kind === "feedback");
  return (
    <>
      {error && (
        <p role="alert" className="mb-4 text-sm text-red-400">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {(["players", "feedback"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "rounded-full border px-4 py-1.5 text-sm " +
                (tab === t
                  ? "border-cyan-glow/50 text-cyan-glow"
                  : "border-edge text-zinc-400")
              }
            >
              {t === "players"
                ? countLabel(visible.length, "player")
                : "Feedback (" + feedback.length + ")"}
            </button>
          ))}
          <button
            aria-pressed={betaOnly}
            onClick={() => {
              setBetaOnly(!betaOnly);
              setTab("players");
            }}
            className={
              "rounded-full border px-4 py-1.5 text-sm " +
              (betaOnly
                ? "border-cyan-glow/50 text-cyan-glow"
                : "border-edge text-zinc-400")
            }
          >
            iPhone beta
          </button>
        </div>
        <button
          className={OUTREACH_ACTION}
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {tab === "players" && (
        <>
          <div className="mt-3 flex gap-1 overflow-x-auto">
            {(["real", "team", "test", "all"] as const).map((k) => (
              <button
                key={k}
                aria-pressed={kindFilter === k}
                onClick={() => setKindFilter(k)}
                className={
                  "shrink-0 rounded-full px-3 py-1.5 text-sm " +
                  (kindFilter === k
                    ? "bg-surface-2 text-white"
                    : "text-zinc-500")
                }
              >
                {k[0].toUpperCase() + k.slice(1)}{" "}
                <span className="text-zinc-600">{kindCounts[k]}</span>
              </button>
            ))}
          </div>
          {betaOnly && (
            <button
              className={OUTREACH_ACTION + " mt-3 sm:hidden"}
              aria-label="Filters"
              aria-expanded={showFilters}
              aria-controls="beta-outreach-filters"
              onClick={() => setShowFilters(!showFilters)}
            >
              Filters
              {[roleFilter, interestFilter, inviteFilter, channelFilter].filter(
                Boolean,
              ).length > 0
                ? ` (${[roleFilter, interestFilter, inviteFilter, channelFilter].filter(Boolean).length})`
                : ""}
            </button>
          )}
          {betaOnly && (
            <div
              id="beta-outreach-filters"
              className={
                "mt-3 grid-cols-1 gap-2 sm:grid-cols-2 " +
                (showFilters ? "grid" : "hidden sm:grid")
              }
            >
              <label className="text-xs text-zinc-500">
                Role
                <select
                  aria-label="Filter role"
                  className={INPUT_CLS + " mt-1 min-h-11 w-full"}
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                >
                  <option value="">All roles</option>
                  <option value="player">Player</option>
                  <option value="coach">Coach</option>
                  <option value="both">Both</option>
                </select>
              </label>
              <label className="min-w-0 text-xs text-zinc-500">
                Interest
                <select
                  aria-label="Filter interest"
                  className={INPUT_CLS + " mt-1 min-h-11 w-full"}
                  value={interestFilter}
                  onChange={(e) => setInterestFilter(e.target.value)}
                >
                  <option value="">All interests</option>
                  {[...PLAYER_INTERESTS, ...COACH_INTERESTS].map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-zinc-500">
                Invitation
                <select
                  aria-label="Filter invitation"
                  className={INPUT_CLS + " mt-1 min-h-11 w-full"}
                  value={inviteFilter}
                  onChange={(e) => setInviteFilter(e.target.value)}
                >
                  <option value="">All invitation states</option>
                  {[
                    "pending",
                    "scheduled",
                    "sending",
                    "sent",
                    "delivered",
                    "unknown",
                    "failed",
                    "needs_attention",
                    "suppressed",
                    "bounced",
                    "complained",
                    "canceled",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {s === "needs_attention"
                        ? "Needs attention"
                        : s[0].toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-zinc-500">
                Contact method
                <select
                  aria-label="Filter contact method"
                  className={INPUT_CLS + " mt-1 min-h-11 w-full"}
                  value={channelFilter}
                  onChange={(e) => setChannelFilter(e.target.value)}
                >
                  <option value="">All contact methods</option>
                  {FEEDBACK_OPTIONS.filter((o) => o.value !== "not_now").map(
                    (o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>
          )}
        </>
      )}
      {tab === "feedback" ? (
        <div className="mt-6">
          {feedback.length ? (
            <ul className="space-y-3">
              {feedback.map((t) => (
                <li
                  key={t.id}
                  className="rounded-2xl border border-edge bg-surface p-4"
                >
                  <p className="text-sm font-medium text-zinc-200">
                    {unified.find((r) => r.touches.some((h) => h.id === t.id))
                      ?.name ?? "Removed entry"}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">
                    {t.body}
                  </p>
                  <p className="mt-2 text-xs text-zinc-500">
                    {t.channel ? CHANNEL_COPY[t.channel] + " · " : ""}
                    {dateLabel(t.at)} · {t.author}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">No feedback logged yet.</p>
          )}
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <section className="mt-8">
              <h2 className="text-sm font-semibold text-zinc-200">
                Pending invitations{" "}
                <span className="ml-2 text-zinc-600">{pending.length}</span>
              </h2>
              {list(pending, "pending")}
            </section>
          )}
          {QUEUE_ORDER.map((key) => {
            const items = visible
              .filter((r) => unifiedQueueFor(r, now) === key)
              .sort((a, b) =>
                (a.follow_up_on ?? "").localeCompare(b.follow_up_on ?? ""),
              );
            return items.length ? (
              <section key={key} className="mt-8">
                <h2 className="text-sm font-semibold text-zinc-200">
                  {QUEUE_COPY[key]}{" "}
                  <span className="ml-2 text-zinc-600">{items.length}</span>
                </h2>
                {list(items, key)}
              </section>
            ) : null;
          })}
          <section className="mt-8">
            <h2 className="text-sm font-semibold text-zinc-200">Everyone</h2>
            {visible.length ? (
              list(visible, "everyone")
            ) : (
              <p className="mt-3 text-sm text-zinc-500">No matching people.</p>
            )}
          </section>
          {!betaOnly && (
            <AddedByHand
              people={[]}
              renderPerson={() => null}
              onAdd={(name, email) =>
                mutate("admin_outreach_person_add", {
                  p_name: name,
                  p_email: email || null,
                })
              }
            />
          )}
          {hidden.length > 0 && (
            <section className="mt-8">
              <button
                className={OUTREACH_ACTION}
                onClick={() => setShowHidden(!showHidden)}
              >
                {showHidden ? "Hide" : "Show"} hidden accounts ({hidden.length})
              </button>
              {showHidden && list(hidden, "hidden")}
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">Added by hand</h2>
        {!adding && (
          <button onClick={() => setAdding(true)} className={OUTREACH_ACTION}>
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
            className={OUTREACH_ACTION}
          >
            {saving ? "Saving…" : "Add"}
          </button>
          <button onClick={() => setAdding(false)} className={OUTREACH_ACTION}>
            Cancel
          </button>
        </div>
      )}
      {people.length > 0 && (
        <ul className="mt-3 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
          {people.map(renderPerson)}
        </ul>
      )}
    </section>
  );
}

function ExpandableRow({
  title,
  identity,
  status,
  meta,
  side,
  open,
  onToggle,
  children,
}: {
  title: string;
  identity?: string | null;
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
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 [overflow-wrap:anywhere] text-sm font-medium text-zinc-200">
            {title}
          </p>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${STATUS_CHIP[status]}`}
          >
            {STATUS_COPY[status]}
          </span>
        </div>
        {identity && <p className="mt-1 [overflow-wrap:anywhere] text-sm text-zinc-400">{identity}</p>}
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 text-xs text-zinc-500">{meta}</p>
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
    body: string,
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
              className={OUTREACH_ACTION}
            >
              Clear
            </button>
          ) : (
            <button
              onClick={() => onFollowUp(inAWeek)}
              className={OUTREACH_ACTION}
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
          className={"mt-2 " + OUTREACH_ACTION}
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
  extra,
  row,
  touches,
  onStatus,
  onFollowUp,
  onHidden,
  onKind,
  onAdd,
  onDeleteTouch,
}: {
  extra?: React.ReactNode;
  row: OutreachRow;
  touches: TouchRow[];
  onStatus: (s: OutreachStatus) => void;
  onFollowUp: (on: string | null) => void;
  onHidden: (h: boolean) => void;
  onKind: (k: PlayerKind) => void;
  onAdd: (
    kind: TouchKind,
    channel: TouchChannel | null,
    body: string,
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

      {extra}
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
        {
          <button
            onClick={() => onHidden(!row.hidden)}
            className={OUTREACH_ACTION}
          >
            {row.hidden ? "Show in outreach" : "Hide from outreach"}
          </button>
        }
      </div>
    </div>
  );
}

function PersonDetail({
  extra,
  person,
  touches,
  onStatus,
  onFollowUp,
  onEdit,
  onDelete,
  onAdd,
  onDeleteTouch,
}: {
  extra?: React.ReactNode;
  person: PersonRow;
  touches: TouchRow[];
  onStatus: (s: OutreachStatus) => void;
  onFollowUp: (on: string | null) => void;
  onEdit: (name: string, email: string) => void;
  onDelete: () => void;
  onAdd: (
    kind: TouchKind,
    channel: TouchChannel | null,
    body: string,
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
            className={OUTREACH_ACTION}
          >
            Save
          </button>
          <button
            onClick={() => {
              setName(person.name);
              setEmail(person.email ?? "");
              setEditing(false);
            }}
            className={OUTREACH_ACTION}
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
          <button onClick={() => setEditing(true)} className={OUTREACH_ACTION}>
            Edit
          </button>
        </div>
      )}

      {extra}
      <ContactControls
        status={person.status}
        followUpOn={person.follow_up_on}
        touches={touches}
        onStatus={onStatus}
        onFollowUp={onFollowUp}
        onAdd={onAdd}
        onDeleteTouch={onDeleteTouch}
      />

      <button onClick={onDelete} className={"mt-4 " + OUTREACH_ACTION}>
        Remove this person
      </button>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="[overflow-wrap:anywhere] text-zinc-200">{value}</dd>
    </div>
  );
}
