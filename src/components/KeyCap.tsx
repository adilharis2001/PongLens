/**
 * One key on a shortcut hint.
 *
 * Shared so the coach workspace and the match player draw the same thing:
 * two surfaces teaching the same keys should not be teaching them in two
 * different typefaces.
 */
export function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-edge bg-surface-2 px-1.5 py-0.5 font-sans text-[10px] font-medium text-zinc-400">
      {children}
    </kbd>
  );
}
