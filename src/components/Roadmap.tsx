import Link from "next/link";
import { SectionHeading } from "@/components/SectionHeading";
import {
  STAGE_DOT,
  STAGE_LABEL,
  groupRoadmap,
  shippedLabel,
  type RoadmapItem,
} from "@/lib/roadmap";

/**
 * The roadmap as a reader sees it: three sections, each hidden when
 * empty, each entry a title and one sentence. Shipped entries carry the
 * month. No hooks, so the public page can render it on the server and
 * the board's tab can render it on the client from the same file.
 */
export function RoadmapSections({ items }: { items: RoadmapItem[] }) {
  const groups = groupRoadmap(items);
  if (groups.length === 0) {
    return <p className="text-sm text-zinc-500">Nothing on the roadmap yet.</p>;
  }
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.stage}>
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[group.stage]}`}
              aria-hidden="true"
            />
            <SectionHeading>{STAGE_LABEL[group.stage]}</SectionHeading>
          </div>
          <ul className="mt-3 space-y-2.5">
            {group.items.map((item) => {
              const when = group.stage === "shipped" ? shippedLabel(item.shipped_at) : null;
              return (
                <li
                  key={item.id}
                  className="rounded-xl border border-edge bg-surface px-4 py-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium text-zinc-100">{item.title}</p>
                    {when && (
                      <span className="shrink-0 text-[11px] text-zinc-500">{when}</span>
                    )}
                  </div>
                  {item.description && (
                    <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                      {item.description}
                    </p>
                  )}
                  {item.link && (
                    <Link
                      href={item.link}
                      className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-cyan-glow transition-colors hover:text-white"
                    >
                      Try it
                      <svg
                        viewBox="0 0 24 24"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
                      </svg>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
