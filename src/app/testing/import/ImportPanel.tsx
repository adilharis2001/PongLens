"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import type { ImportPlan } from "@/lib/qa/import";

interface Result {
  plan: ImportPlan;
  committed: boolean;
  created?: number;
  updated?: number;
  refused?: number[];
  error?: string;
}

export function ImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const send = useCallback(async (chosen: File, commit: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", chosen);
      const res = await fetch(`/api/qa/import${commit ? "?commit=1" : ""}`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json()) as Result & { error?: string };
      if (!res.ok && !body.plan) {
        setError(body.error ?? "That file could not be read.");
        setResult(null);
      } else {
        setResult(body);
        if (body.error) setError(body.error);
      }
    } catch {
      setError("That did not reach us. Try again.");
    }
    setBusy(false);
  }, []);

  const choose = useCallback(
    (chosen: File) => {
      setFile(chosen);
      setResult(null);
      void send(chosen, false);
    },
    [send],
  );

  const plan = result?.plan;
  const committed = result?.committed === true;

  return (
    <div className="mt-8">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) choose(dropped);
        }}
        className={`rounded-2xl border p-6 transition-colors ${
          dragging
            ? "border-cyan-glow/60 bg-cyan-glow/5"
            : "border-edge bg-surface"
        }`}
      >
        <p className="text-sm leading-relaxed text-zinc-400">
          Drop a filled-in template here, or choose the file. Nothing is
          saved until you have seen what it would do.
        </p>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            if (chosen) choose(chosen);
            e.target.value = "";
          }}
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-cyan-glow disabled:opacity-40"
          >
            Choose a file
          </button>
          <a
            href="/api/qa/export?what=template"
            className="text-sm font-medium text-zinc-400 transition-colors hover:text-cyan-glow"
          >
            Download the template
          </a>
          {file && (
            <span className="text-sm text-zinc-500">{file.name}</span>
          )}
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-amber-300">{error}</p>}
      {busy && <p className="mt-4 text-sm text-zinc-500">Reading it…</p>}

      {plan && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-edge bg-surface px-3.5 py-1.5 text-sm text-zinc-300">
              New{" "}
              <span className="font-semibold tabular-nums text-zinc-100">
                {committed ? (result?.created ?? 0) : plan.creates}
              </span>
            </span>
            <span className="rounded-full border border-edge bg-surface px-3.5 py-1.5 text-sm text-zinc-300">
              Updated{" "}
              <span className="font-semibold tabular-nums text-zinc-100">
                {committed ? (result?.updated ?? 0) : plan.updates}
              </span>
            </span>
            {plan.errors > 0 && (
              <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3.5 py-1.5 text-sm text-amber-300">
                Problems{" "}
                <span className="font-semibold tabular-nums">{plan.errors}</span>
              </span>
            )}
          </div>

          {plan.unknownColumns.length > 0 && (
            <p className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm leading-relaxed text-amber-200/90">
              These columns are not ones we read, so nothing in them was
              used: {plan.unknownColumns.join(", ")}. Check for a typo in
              the header row.
            </p>
          )}

          {committed ? (
            <div className="mt-5 rounded-2xl border border-edge bg-surface p-5">
              <p className="text-base font-medium text-zinc-100">Imported.</p>
              {(result?.refused?.length ?? 0) > 0 && (
                <p className="mt-2 text-sm leading-relaxed text-amber-200/90">
                  Line{result!.refused!.length === 1 ? "" : "s"}{" "}
                  {result!.refused!.join(", ")} could not be changed. A bug
                  that is already closed is no longer yours to edit.
                </p>
              )}
              <Link
                href="/testing/bugs"
                className="mt-4 inline-block rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink"
              >
                See the queue
              </Link>
            </div>
          ) : (
            plan.rows.length > 0 && (
              <>
                <ul className="mt-5 overflow-hidden rounded-2xl border border-edge bg-surface">
                  {plan.rows.map((row) => (
                    <li
                      key={row.line}
                      className="flex items-start gap-3 border-b border-edge/60 px-4 py-3 last:border-b-0"
                    >
                      <span className="w-12 shrink-0 font-mono text-[11px] text-zinc-600">
                        L{row.line}
                      </span>
                      <span
                        className={`w-16 shrink-0 rounded-full border px-2 py-0.5 text-center text-[10px] font-semibold ${
                          row.action === "error"
                            ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                            : row.action === "update"
                              ? "border-edge bg-surface-2 text-zinc-300"
                              : "border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow"
                        }`}
                      >
                        {row.action === "error"
                          ? "Problem"
                          : row.action === "update"
                            ? "Update"
                            : "New"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-zinc-200">
                          {row.title || <em className="text-zinc-500">no title</em>}
                        </span>
                        {row.errors.length > 0 && (
                          <span className="mt-1 block text-xs leading-relaxed text-amber-300">
                            {row.errors.join(". ")}.
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="mt-5 flex items-center gap-4">
                  <button
                    type="button"
                    disabled={busy || plan.errors > 0 || !file}
                    onClick={() => file && void send(file, true)}
                    className="rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink disabled:opacity-40"
                  >
                    Import {plan.creates + plan.updates} row
                    {plan.creates + plan.updates === 1 ? "" : "s"}
                  </button>
                  {plan.errors > 0 && (
                    <span className="text-sm text-zinc-500">
                      Fix the problems above and drop the file again.
                    </span>
                  )}
                </div>
              </>
            )
          )}
        </div>
      )}
    </div>
  );
}
