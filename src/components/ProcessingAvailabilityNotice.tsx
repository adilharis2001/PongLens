import { availabilityNotice, type AvailabilityContext } from "@/lib/processingAvailability";

/** Inline content for the existing status/action card, never another card. */
export function ProcessingAvailabilityNotice({ state, context, className = "mt-3" }: {
  state: unknown; context: AvailabilityContext; className?: string;
}) {
  const notice = availabilityNotice(state, context);
  if (!notice) return null;
  return <div role="status" className={`${className} text-left`}>
    <p className="text-sm font-medium text-zinc-200">{notice.title}</p>
    <p className="mt-2 text-sm leading-relaxed text-zinc-400">{notice.body}</p>
  </div>;
}
