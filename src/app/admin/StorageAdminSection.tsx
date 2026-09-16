"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Storage, the admin view: pending quota requests (grant / custom / deny,
 * the RPCs from 010), the two defaults (ordinary accounts and team/test
 * accounts, app_config), last night's measurement of the buckets with a
 * button to run it now, and every account that stores anything with its
 * live number, the tally's number and the measured number side by side.
 *
 * The "in tally" column is the whole point of the page: the running
 * tally only has to be right for the last day, and this is where a
 * feature that forgot to book its bytes shows itself.
 */

const GB = 1024 ** 3;

interface QuotaRequest {
  id: string;
  user_id: string;
  email: string;
  name: string | null;
  message: string;
  created_at: string;
  used_bytes: number;
  storage_limit_bytes: number;
}

interface OverviewRow {
  user_id: string;
  email: string;
  name: string | null;
  kind: "real" | "team" | "test";
  storage_limit_bytes: number;
  used_bytes: number;
  ledger_bytes: number;
  snapshot_bytes: number | null;
  snapshot_ledger_bytes: number | null;
  snapshot_at: string | null;
  breakdown: Record<string, number> | null;
}

interface Sample {
  bucket: string;
  key: string;
  size: number;
  reason: string;
}

interface Run {
  id: string;
  started_at: string;
  finished_at: string | null;
  objects: number | null;
  bytes: number | null;
  accounts: number | null;
  platform_bytes: number | null;
  unattributed: { objects: number; bytes: number; samples: Sample[] } | Sample[];
  error: string | null;
}

function gb(n: number) {
  const v = (n / GB).toFixed(1);
  return v.endsWith(".0") ? v.slice(0, -2) : v;
}

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const KIND_LABEL: Record<OverviewRow["kind"], string> = {
  real: "",
  team: "team",
  test: "test",
};

export function StorageAdminSection() {
  const [requests, setRequests] = useState<QuotaRequest[] | null>(null);
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [defaultGb, setDefaultGb] = useState<string>("");
  const [teamGb, setTeamGb] = useState<string>("");
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [customFor, setCustomFor] = useState<string | null>(null);
  const [customGb, setCustomGb] = useState("");
  const [editUser, setEditUser] = useState<string | null>(null);
  const [editGb, setEditGb] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [reqRes, overviewRes, runRes, cfgRes] = await Promise.all([
      supabase.rpc("admin_quota_requests"),
      supabase.rpc("admin_storage_overview"),
      supabase
        .from("storage_snapshot_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("app_config")
        .select("key, value")
        .in("key", ["default_storage_bytes", "team_storage_bytes"]),
    ]);
    if (reqRes.data) setRequests(reqRes.data as QuotaRequest[]);
    if (overviewRes.data) setRows(overviewRes.data as OverviewRow[]);
    if (overviewRes.error) setError(overviewRes.error.message);
    setRun((runRes.data as Run | null) ?? null);
    for (const row of (cfgRes.data ?? []) as { key: string; value: string }[]) {
      if (row.key === "default_storage_bytes") setDefaultGb(String(Number(row.value) / GB));
      if (row.key === "team_storage_bytes") setTeamGb(String(Number(row.value) / GB));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(
    r: QuotaRequest,
    action: "grant" | "deny",
    newLimitBytes?: number
  ) {
    setBusy(r.id);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } =
      action === "grant"
        ? await supabase.rpc("admin_grant_quota", {
            p_request_id: r.id,
            p_new_limit_bytes: newLimitBytes,
          })
        : await supabase.rpc("admin_deny_quota", { p_request_id: r.id });
    setBusy(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setCustomFor(null);
    setCustomGb("");
    await load();
  }

  function grantCustom(r: QuotaRequest) {
    const n = Number(customGb);
    if (!Number.isFinite(n) || n <= 0 || n > 1024) {
      setError("Enter a limit between 1 and 1024 GB.");
      return;
    }
    void decide(r, "grant", Math.round(n * GB));
  }

  async function setUserLimit(u: OverviewRow) {
    const n = Number(editGb);
    if (!Number.isFinite(n) || n <= 0 || n > 1024) {
      setError("Enter a limit between 1 and 1024 GB.");
      return;
    }
    setBusy(u.user_id);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("admin_set_quota", {
      p_user_id: u.user_id,
      p_new_limit_bytes: Math.round(n * GB),
    });
    setBusy(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setEditUser(null);
    setEditGb("");
    await load();
  }

  async function saveDefault(key: "default_storage_bytes" | "team_storage_bytes", value: string) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || n > 1024) {
      setError("Enter a default between 1 and 1024 GB.");
      return;
    }
    setBusy(key);
    setError(null);
    const supabase = createClient();
    const { error: dbError } = await supabase
      .from("app_config")
      .update({ value: String(Math.round(n * GB)) })
      .eq("key", key);
    setBusy(null);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    setSavedKey(key);
    window.setTimeout(() => setSavedKey(null), 1500);
  }

  async function measureNow() {
    setBusy("measure");
    setError(null);
    try {
      const res = await fetch("/api/cron/storage-snapshot", { method: "POST" });
      if (!res.ok) setError("The measurement did not finish. Check the latest run below.");
    } catch {
      setError("The measurement did not start. Try again.");
    } finally {
      setBusy(null);
      await load();
    }
  }

  const unattributed =
    run && !Array.isArray(run.unattributed) ? run.unattributed : null;

  return (
    <section>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}

      {/* Defaults: ordinary accounts, and team/test accounts */}
      <div className="rounded-2xl border border-edge bg-surface px-4 py-3">
        {(
          [
            ["default_storage_bytes", "Default for new accounts", defaultGb, setDefaultGb],
            ["team_storage_bytes", "Team and test accounts", teamGb, setTeamGb],
          ] as const
        ).map(([key, label, value, setValue]) => (
          <div key={key} className="flex flex-wrap items-center gap-3 py-1.5">
            <p className="text-sm text-zinc-300">{label}</p>
            <span className="ml-auto flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={1024}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-label={`${label} in GB`}
                className="w-20 rounded-lg border border-edge bg-surface-2/40 px-3 py-1.5 text-sm text-zinc-100 focus:border-cyan-glow/60 focus:outline-none"
              />
              <span className="text-xs text-zinc-500">GB</span>
              <button
                type="button"
                disabled={busy === key}
                onClick={() => void saveDefault(key, value)}
                className="rounded-full border border-cyan-glow/50 px-4 py-1.5 text-sm font-medium text-cyan-glow disabled:opacity-60"
              >
                {savedKey === key ? "Saved" : "Save"}
              </button>
            </span>
          </div>
        ))}
        <p className="w-full pt-1 text-xs leading-relaxed text-zinc-500">
          Applies to accounts created from now on. An account tagged team or
          test in the players list gets the team allowance when it is
          tagged; existing accounts keep their limit and can be changed
          below.
        </p>
      </div>

      {/* Last measurement of the buckets */}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-edge bg-surface px-4 py-3">
        <div className="min-w-0 flex-1 text-sm text-zinc-300">
          {run === null ? (
            <p>The buckets have not been measured yet.</p>
          ) : run.error ? (
            <p className="text-amber-300">
              The measurement started {when(run.started_at)} failed: {run.error}
            </p>
          ) : run.finished_at === null ? (
            <p>Measuring, started {when(run.started_at)}…</p>
          ) : (
            <p>
              Measured {when(run.started_at)}: {gb(run.bytes ?? 0)} GB in{" "}
              {(run.objects ?? 0).toLocaleString()} files across {run.accounts ?? 0}{" "}
              accounts, plus {gb(run.platform_bytes ?? 0)} GB of our own files.
            </p>
          )}
          {unattributed && unattributed.objects > 0 && (
            <p className="mt-1 text-amber-300">
              {unattributed.objects.toLocaleString()} files ({gb(unattributed.bytes)} GB)
              belong to nobody:
              {unattributed.samples.slice(0, 4).map((s) => (
                <span key={s.key} className="ml-2 font-mono text-xs">
                  {s.bucket}/{s.key}
                </span>
              ))}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={busy === "measure"}
          onClick={() => void measureNow()}
          className="rounded-full border border-cyan-glow/50 px-4 py-1.5 text-sm font-medium text-cyan-glow disabled:opacity-60"
        >
          {busy === "measure" ? "Measuring…" : "Measure now"}
        </button>
      </div>

      {/* Pending requests */}
      <h3 className="mt-6 text-sm font-semibold text-zinc-300">
        Quota requests
      </h3>
      {requests === null ? null : requests.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">No pending requests.</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {requests.map((r) => (
            <li
              key={r.id}
              className="rounded-2xl border border-edge bg-surface p-5"
            >
              <p className="text-sm font-medium text-zinc-200">
                {r.name || r.email}
              </p>
              <p className="text-xs text-zinc-500">{r.email}</p>
              <p className="mt-1 text-xs text-zinc-500">
                Using {gb(r.used_bytes)} of {gb(r.storage_limit_bytes)} GB
              </p>
              {r.message && (
                <p className="mt-2 rounded-lg bg-surface-2/60 px-3 py-2 text-sm text-zinc-300">
                  {r.message}
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy === r.id}
                  onClick={() =>
                    void decide(r, "grant", r.storage_limit_bytes + 25 * GB)
                  }
                  className="rounded-full bg-cyan-glow px-4 py-1.5 text-sm font-semibold text-ink disabled:opacity-60"
                >
                  Grant +25 GB
                </button>
                {customFor === r.id ? (
                  <span className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={1024}
                      value={customGb}
                      onChange={(e) => setCustomGb(e.target.value)}
                      placeholder="GB"
                      className="w-20 rounded-lg border border-edge bg-surface-2/40 px-3 py-1.5 text-sm text-zinc-100 focus:border-cyan-glow/60 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={busy === r.id}
                      onClick={() => grantCustom(r)}
                      className="rounded-full border border-cyan-glow/50 px-4 py-1.5 text-sm font-medium text-cyan-glow disabled:opacity-60"
                    >
                      Set limit
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => {
                      setCustomFor(r.id);
                      setCustomGb("");
                    }}
                    className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:text-white disabled:opacity-60"
                  >
                    Grant custom
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy === r.id}
                  onClick={() => void decide(r, "deny")}
                  className="rounded-full border border-red-500/40 px-4 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-60"
                >
                  Deny
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Every account that stores anything */}
      {rows.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-zinc-300">Accounts</h3>
          <div className="mt-2 overflow-x-auto rounded-2xl border border-edge bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="px-4 py-2 font-medium">Account</th>
                  <th className="px-4 py-2 text-right font-medium">Used / limit</th>
                  <th className="px-4 py-2 text-right font-medium">Measured</th>
                  <th className="px-4 py-2 text-right font-medium">In tally</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge/60">
                {rows.map((u) => {
                  const drift =
                    u.snapshot_bytes === null || u.snapshot_ledger_bytes === null
                      ? null
                      : u.snapshot_ledger_bytes - u.snapshot_bytes;
                  const full = u.used_bytes >= u.storage_limit_bytes;
                  return (
                    <tr key={u.user_id}>
                      <td className="max-w-[16rem] truncate px-4 py-2 text-zinc-300">
                        {u.name || u.email}
                        {KIND_LABEL[u.kind] && (
                          <span className="ml-2 rounded-full border border-edge px-2 py-0.5 text-[11px] text-zinc-500">
                            {KIND_LABEL[u.kind]}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                        {editUser === u.user_id ? (
                          <span className="flex items-center justify-end gap-2">
                            <input
                              type="number"
                              min={1}
                              max={1024}
                              value={editGb}
                              onChange={(e) => setEditGb(e.target.value)}
                              placeholder="GB"
                              autoFocus
                              className="w-20 rounded-lg border border-edge bg-surface-2/40 px-3 py-1 text-sm text-zinc-100 focus:border-cyan-glow/60 focus:outline-none"
                            />
                            <button
                              type="button"
                              disabled={busy === u.user_id}
                              onClick={() => void setUserLimit(u)}
                              className="text-xs font-medium text-cyan-glow disabled:opacity-60"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditUser(null)}
                              className="text-xs text-zinc-500 hover:text-zinc-300"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditUser(u.user_id);
                              setEditGb(gb(u.storage_limit_bytes));
                            }}
                            title="Change this account's limit"
                            className={`text-xs tabular-nums transition-colors hover:text-cyan-glow ${
                              full ? "text-red-400" : "text-zinc-400"
                            }`}
                          >
                            {gb(u.used_bytes)} / {gb(u.storage_limit_bytes)} GB
                          </button>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right text-xs tabular-nums text-zinc-400">
                        {u.snapshot_at === null || u.snapshot_bytes === null
                          ? "not yet"
                          : `${gb(u.snapshot_bytes)} GB · ${when(u.snapshot_at)}`}
                      </td>
                      <td
                        className={`whitespace-nowrap px-4 py-2 text-right text-xs tabular-nums ${
                          drift !== null && Math.abs(drift) > 0.05 * GB
                            ? "text-amber-300"
                            : "text-zinc-500"
                        }`}
                      >
                        {gb(u.ledger_bytes)} GB
                        {drift !== null && Math.abs(drift) > 0.05 * GB && (
                          <span className="ml-1">
                            ({drift > 0 ? "+" : "−"}
                            {gb(Math.abs(drift))} vs measured)
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
