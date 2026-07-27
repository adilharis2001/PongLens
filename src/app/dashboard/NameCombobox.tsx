"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * A text field that suggests names you have used before.
 *
 * Free text first, suggestions second: the field always accepts anything you
 * type, and the list under it only offers what you already have. That matters
 * for opponents — chips would be fine for the handful of clubs you play at,
 * but somebody with three seasons of tournaments has hundreds of opponents,
 * and hundreds of chips is a wall, not a shortcut. A list that filters as you
 * type is the only shape that survives that.
 *
 * Matching is prefix-first, then substring, so typing "ch" puts "Chris" above
 * "Richard". The panel floats (absolute) rather than sitting in the flow, so
 * opening it never shoves the rest of the form down the screen, and it caps
 * at a few rows with its own scroll.
 */
export function NameCombobox({
  value,
  options,
  onChange,
  onCommit,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string;
  /** Everything the user has used before, best-first (most recent). */
  options: string[];
  onChange: (v: string) => void;
  /** Persist — called on blur and after picking a suggestion. */
  onCommit: () => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const q = value.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return options.slice(0, 50);
    const starts: string[] = [];
    const contains: string[] = [];
    for (const o of options) {
      const l = o.toLowerCase();
      if (l.startsWith(q)) starts.push(o);
      else if (l.includes(q)) contains.push(o);
    }
    return [...starts, ...contains].slice(0, 50);
  }, [options, q]);

  // Nothing to offer when the only match is what you have already typed.
  const redundant =
    matches.length === 1 && matches[0].toLowerCase() === q && q.length > 0;
  const show = open && matches.length > 0 && !redundant;

  // Any tap outside closes. Pointerdown rather than click so it beats the
  // option's own mousedown handling on touch.
  useEffect(() => {
    if (!show) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [show]);

  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
    setActive(-1);
    // The value only just changed, so let React flush before persisting.
    setTimeout(onCommit, 0);
  };

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          show && active >= 0 ? `${listId}-${active}` : undefined
        }
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => onCommit()}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, -1));
          } else if (e.key === "Enter") {
            if (show && active >= 0) {
              e.preventDefault();
              choose(matches[active]);
            } else {
              e.currentTarget.blur();
            }
          } else if (e.key === "Escape" && show) {
            e.preventDefault();
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        enterKeyHint="done"
        className={className}
      />
      {show && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-44 overflow-y-auto overscroll-contain rounded-xl border border-edge bg-surface shadow-lg shadow-black/50"
        >
          {matches.map((m, i) => (
            <li key={m} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                // Keep focus in the field so blur-to-persist doesn't fire
                // before the tap lands.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(m)}
                onMouseEnter={() => setActive(i)}
                className={`block w-full truncate px-4 py-2.5 text-left text-sm transition-colors ${
                  i === active
                    ? "bg-surface-2 text-white"
                    : "text-zinc-300 hover:bg-surface-2"
                }`}
              >
                {m}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
