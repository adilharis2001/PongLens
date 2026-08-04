"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Storage, the admin view: pending quota requests (grant / custom / deny,
 * the RPCs from 010), the top users list with direct per-user limit edits
 * (admin_set_quota, 043), and the default for new accounts
 * (app_config.default_storage_bytes, written under the admin RLS policy).
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

interface TopUser {
  user_id: string;
  email: string;
  name: string | null;
  used_bytes: number;
  storage_limit_bytes: number;
}

function gb(n: number) {
  const v = (n / GB).toFixed(1);
  return v.endsWith(".0") ? v.slice(0, -2) : v;
}

export function StorageAdminSection() {
  const [requests, setRequests] = useState<QuotaRequest[] | null>(null);
  const [topUsers, setTopUsers] = useState<TopUser[]>([]);
  const [defaultGb, setDefaultGb] = useState<string>("");
  const [savedDefault, setSavedDefault] = useState(false);
  const [customFor, setCustomFor] = useState<string | null>(null);
  const [customGb, setCustomGb] = useState("");
  const [editUser, setEditUser] = useState<string | null>(null);
  const [editGb, setEditGb] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [reqRes, topRes, cfgRes] = await Promise.all([
      supabase.rpc("admin_quota_requests"),
      supabase.rpc("admin_top_storage"),
      supabase
        .from("app_config")
        .select("value")
        .eq("key", "default_storage_bytes")
        .maybeSingle(),
    ]);
    if (reqRes.data) setRequests(reqRes.data as QuotaRequest[]);
    if (topRes.data) setTopUsers(topRes.data as TopUser[]);
    if (cfgRes.data?.value) {
      setDefaultGb(String(Number(cfgRes.data.value) / GB));
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

  async function setUserLimit(u: TopUser) {
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

  async function saveDefault() {
    const n = Number(defaultGb);
    if (!Number.isFinite(n) || n <= 0 || n > 1024) {
      setError("Enter a default between 1 and 1024 GB.");
      return;
    }
    setBusy("default");
    setError(null);
    const supabase = createClient();
    const { error: dbError } = await supabase
      .from("app_config")
      .update({ value: String(Math.round(n * GB)) })
      .eq("key", "default_storage_bytes");
    setBusy(null);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    setSavedDefault(true);
    window.setTimeout(() => setSavedDefault(false), 1500);
  }

  return (
    <section>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}

      {/* Default for new accounts */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-edge bg-surface px-4 py-3">
        <p className="text-sm text-zinc-300">Default for new accounts</p>
        <span className="ml-auto flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={1024}
            value={defaultGb}
            onChange={(e) => setDefaultGb(e.target.value)}
            aria-label="Default storage in GB"
            className="w-20 rounded-lg border border-edge bg-surface-2/40 px-3 py-1.5 text-sm text-zinc-100 focus:border-cyan-glow/60 focus:outline-none"
          />
          <span className="text-xs text-zinc-500">GB</span>
          <button
            type="button"
            disabled={busy === "default"}
            onClick={() => void saveDefault()}
            className="rounded-full border border-cyan-glow/50 px-4 py-1.5 text-sm font-medium text-cyan-glow disabled:opacity-60"
          >
            {savedDefault ? "Saved" : "Save"}
          </button>
        </span>
        <p className="w-full text-xs leading-relaxed text-zinc-500">
          Applies to accounts created from now on. Existing accounts keep
          their limit; adjust them below.
        </p>
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
                    void decide(r, "grant", r.storage_limit_bytes + 2 * GB)
                  }
                  className="rounded-full bg-cyan-glow px-4 py-1.5 text-sm font-semibold text-ink disabled:opacity-60"
                >
                  Grant +2 GB
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

      {/* Top users, each limit editable in place */}
      {topUsers.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-zinc-300">
            Top users by storage
          </h3>
          <ul className="mt-2 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
            {topUsers.map((u) => (
              <li
                key={u.user_id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate text-zinc-300">
                  {u.name || u.email}
                </span>
                {editUser === u.user_id ? (
                  <span className="flex items-center gap-2">
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
                    title="Change this user's limit"
                    className="shrink-0 text-xs tabular-nums text-zinc-500 transition-colors hover:text-cyan-glow"
                  >
                    {gb(u.used_bytes)} / {gb(u.storage_limit_bytes)} GB
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
