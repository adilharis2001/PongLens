"use client";

import { motion, useReducedMotion } from "motion/react";

const STUDENTS = [
  { initials: "MC", name: "Maya Chen", matches: 3, entries: 8 },
  { initials: "JL", name: "Jonas Lee", matches: 1, entries: 5 },
  { initials: "AR", name: "Ana Ruiz", matches: 4, entries: 11 },
];

export function StudentRoster() {
  const reduced = useReducedMotion();

  return (
    <div
      role="img"
      aria-label="A coach roster with matches and lesson entries for each student"
      className="absolute inset-0 flex items-center justify-center bg-[#0a0a12] px-7"
    >
      <div className="w-full max-w-[280px] space-y-2">
        {STUDENTS.map((student, index) => (
          <motion.div
            key={student.name}
            className="flex items-center gap-3 rounded-xl border bg-surface-2/80 px-3 py-2.5"
            initial={false}
            animate={
              reduced
                ? { borderColor: index === 0 ? "rgba(34,211,238,.5)" : "#262633" }
                : {
                    borderColor: [
                      "#262633",
                      "rgba(34,211,238,.55)",
                      "#262633",
                      "#262633",
                    ],
                    x: [0, 3, 0, 0],
                  }
            }
            transition={{
              duration: 4.8,
              times: [0, 0.05, 0.3, 1],
              repeat: Infinity,
              delay: index * 1.6,
              ease: "easeInOut",
            }}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-cyan-glow/10 text-[10px] font-semibold text-cyan-glow">
              {student.initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium text-zinc-200">
                {student.name}
              </span>
              <span className="mt-0.5 block text-[10px] text-zinc-500">
                {student.matches} matches · {student.entries} entries
              </span>
            </span>
            <span className="text-zinc-600">›</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
