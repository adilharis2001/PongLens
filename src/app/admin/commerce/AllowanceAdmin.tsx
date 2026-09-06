"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AllowanceResource } from "@/lib/commerce/allowances";

type Player = { user_id: string; name: string | null; email: string; minutes_balance?: number; storage_limit_bytes?: number; used_bytes?: number };
type RequestRow = Player & { id: string; resource: AllowanceResource; message: string; created_at: string };
const FIELD = "w-full rounded-xl border border-edge bg-ink px-3 py-2 text-sm text-zinc-100 focus:border-cyan-glow focus:outline-none";
const PILL = "rounded-full border border-edge px-4 py-2 text-sm text-zinc-200 disabled:opacity-50";

export function AllowanceAdmin() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Player | null>(null);
  const [request, setRequest] = useState<RequestRow | null>(null);
  const [resource, setResource] = useState<AllowanceResource>("minutes");
  const [amount, setAmount] = useState("250");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc("admin_allowance_requests");
    if (error) setStatus("Could not load requests. Refresh to try again.");
    else { setRequests(data ?? []); setLoaded(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      const { data, error } = await createClient().rpc("admin_allowance_players", { p_search: search });
      if (!active) return;
      if (error) setStatus("Could not load players. Try again.");
      else setPlayers(data ?? []);
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [search]);
  const pickRequest = async (row: RequestRow) => {
    setRequest(row); setSelected(row); setResource(row.resource);
    setAmount(row.resource === "storage" ? "10" : "250"); setNote(""); setStatus(null);
    const { data } = await createClient().rpc("admin_allowance_players", { p_search: row.email });
    const player = (data as Player[] | null)?.find((p) => p.user_id === row.user_id);
    if (player) setSelected((current) => current?.user_id === row.user_id ? player : current);
    document.getElementById("allowance-grant")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const resolve = async (decline: boolean) => {
    if (!selected || busy) return;
    setBusy(true); setStatus(null);
    try {
      const { error } = await createClient().rpc("admin_resolve_allowance", {
        p_user_id: selected.user_id, p_resource: resource, p_amount: decline ? 0 : Number(amount),
        p_request_id: request?.id ?? null, p_decline: decline, p_note: note,
      });
      if (error) {
        setStatus(error.message.includes("already_decided") ? "This request has already been reviewed. Refresh the list." : "Could not save. Check the amount and try again.");
        await load(); return;
      }
      setStatus(decline ? "Request declined. The player has been notified." : `Added ${amount} ${resource === "storage" ? "GB" : "minutes"} for ${selected.name || selected.email}. The player has been notified.`);
      setSelected(null); setRequest(null); setSearch(""); setNote(""); await load();
    } catch { setStatus("Could not save. Check your connection and try again."); }
    finally { setBusy(false); }
  };
  const validAmount = Number.isInteger(Number(amount)) && Number(amount) > 0 && Number(amount) <= (resource === "storage" ? 1024 : 100000);
  return (
    <div id="requests" className="scroll-mt-20 space-y-6">
      <section>
        <h2 className="text-lg font-semibold">Allowance requests</h2>
        {!loaded ? <p className="mt-3 text-sm text-zinc-400">Loading requests…</p> : requests.length === 0 ? <p className="mt-3 text-sm text-zinc-400">No pending requests.</p> : (
          <ul className="mt-3 space-y-3">
            {requests.map((r) => <li key={r.id} className="rounded-2xl border border-edge bg-surface p-4">
              <p className="font-medium">{r.name || r.email}</p>
              <p className="break-all text-sm text-zinc-400">{r.email}</p>
              <p className="mt-2 text-sm text-zinc-300">Requested more {r.resource === "storage" ? "storage" : "processing minutes"} · {new Date(r.created_at).toLocaleDateString()}</p>
              {r.message && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-300">{r.message}</p>}
              <button disabled={busy} onClick={() => void pickRequest(r)} className={PILL + " mt-3"}>Review request</button>
            </li>)}
          </ul>
        )}
      </section>
      <section id="allowance-grant" className="scroll-mt-20 rounded-2xl border border-edge bg-surface p-5">
        <h2 className="text-lg font-semibold">{request ? "Review request" : "Grant to a player"}</h2>
        {selected ? <div className="my-3">
          <p className="font-medium">{selected.name || selected.email}</p>
          <p className="break-all text-sm text-zinc-400">{selected.email}</p>
          {selected.minutes_balance != null && <p className="mt-2 text-sm text-zinc-300">{selected.minutes_balance} minutes left · {((selected.used_bytes ?? 0) / 1073741824).toFixed(1)} of {((selected.storage_limit_bytes ?? 0) / 1073741824).toFixed(1)} GB used</p>}
          <button disabled={busy} onClick={() => { setSelected(null); setRequest(null); }} className={PILL + " mt-3"}>Choose another player</button>
        </div> : <div className="mt-3">
          <input aria-label="Find a player" placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} className={FIELD} />
          <ul aria-label="Players" className="mt-2 max-h-60 overflow-y-auto">
            {players.map((p) => <li key={p.user_id}>
              <button onClick={() => { setSelected(p); setStatus(null); }} className="w-full rounded-lg px-3 py-3 text-left hover:bg-surface-2">
                <span className="block text-sm font-medium">{p.name || p.email}</span>
                <span className="block break-all text-sm text-zinc-400">{p.email}</span>
              </button>
            </li>)}
            {players.length === 0 && <li className="p-3 text-sm text-zinc-400">No players found.</li>}
          </ul>
        </div>}
        {selected && <div className="space-y-3">
          <label className="block text-sm text-zinc-300">Allowance
            <select disabled={!!request || busy} value={resource} onChange={(e) => { const value = e.target.value as AllowanceResource; setResource(value); setAmount(value === "storage" ? "10" : "250"); }} className={FIELD + " mt-1"}>
              <option value="minutes">Processing minutes</option><option value="storage">Storage</option>
            </select>
          </label>
          <label className="block text-sm text-zinc-300">{resource === "storage" ? "GB to add" : "Minutes to add"}
            <input type="number" min={1} max={resource === "storage" ? 1024 : 100000} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} className={FIELD + " mt-1"} />
          </label>
          <label className="block text-sm text-zinc-300">Message to the player (optional)
            <textarea maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={FIELD + " mt-1"} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy || !validAmount} onClick={() => void resolve(false)} className="rounded-full bg-cyan-glow px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">
              {busy ? "Saving…" : `Grant ${validAmount ? amount : ""} ${resource === "storage" ? "GB" : "minutes"}`}
            </button>
            {request && <button disabled={busy} onClick={() => void resolve(true)} className={PILL}>Decline request</button>}
          </div>
        </div>}
        {status && <p role="status" className="mt-3 text-sm text-zinc-300">{status}</p>}
      </section>
    </div>
  );
}
