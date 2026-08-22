/**
 * Turning a filled-in spreadsheet into bug rows.
 *
 * Two rules shape this. Nothing is written until the person has seen what
 * would happen, because a bad import is far more annoying to undo than to
 * preview. And a row that fails takes only itself down: one wrong
 * severity in row 7 must not throw away the eleven rows around it.
 *
 * The export writes display labels ("Major", "The match page") while the
 * database stores keys ("major", "match"). Import accepts either, so a
 * round trip through Sheets does not have to be lossless in wording to be
 * lossless in meaning.
 *
 * What import deliberately cannot do is move a bug's status. The allowed
 * transitions differ by who you are and are enforced by two policies in
 * 104; a spreadsheet column is the wrong place to discover that. Status
 * lives in the table, where the control only offers the moves you have.
 */

// Explicit .ts extensions: these are value imports, and node --test runs
// this module directly. The repo does the same in src/lib/backlog.
import {
  KIND_LABEL,
  SEVERITY_LABEL,
  type BugArea,
  type BugKind,
  type BugSeverity,
} from "./bugs.ts";
import { parseCsvRecords } from "./csv.ts";
import { parseMatchRef, UUID_RE } from "./matchRef.ts";
import { AREA_TITLE, TEST_AREAS } from "./testLibrary.ts";

export interface ImportRow {
  /** 1-based line in the file as a person sees it, header counted. */
  line: number;
  action: "create" | "update" | "error";
  errors: string[];
  id?: string;
  title: string;
  values: {
    title: string;
    steps: string;
    expected: string;
    actual: string;
    kind: BugKind;
    area: BugArea;
    severity: BugSeverity;
    case_id: string;
    match_id: string | null;
    video_seconds: number | null;
    device: string;
    url: string;
  };
}

export interface ImportPlan {
  rows: ImportRow[];
  creates: number;
  updates: number;
  errors: number;
  /** Header columns the importer does not use, so a typo is visible. */
  unknownColumns: string[];
}

const KNOWN_COLUMNS = new Set([
  "id",
  "title",
  "severity",
  "kind",
  "area",
  "steps",
  "expected",
  "actual",
  "case_id",
  "match_id",
  "video_seconds",
  "device",
  "url",
  // Written by the export, ignored on the way back in.
  "status",
  "browser",
  "viewport",
  "build_sha",
  "resolution",
  "created_at",
  "updated_at",
]);

const UUID = UUID_RE;

/** Match a value against keys and their display labels, case-insensitively. */
function fromLabel<T extends string>(
  value: string,
  labels: Record<T, string>,
): T | null {
  const want = value.trim().toLowerCase();
  if (!want) return null;
  for (const key of Object.keys(labels) as T[]) {
    if (key.toLowerCase() === want) return key;
    if (labels[key].toLowerCase() === want) return key;
  }
  return null;
}

function areaFrom(value: string): BugArea | null {
  const want = value.trim().toLowerCase();
  if (!want) return null;
  if (want === "other" || want === "something else") return "other";
  for (const area of TEST_AREAS) {
    if (area.key === want) return area.key;
    if (AREA_TITLE[area.key].toLowerCase() === want) return area.key;
  }
  return null;
}

/** "2:12" and "132" both mean the same moment. */
export function parseVideoSeconds(value: string): number | null | "invalid" {
  const text = value.trim();
  if (!text) return null;
  if (text.includes(":")) {
    const parts = text.split(":");
    if (parts.length !== 2) return "invalid";
    const mins = Number(parts[0]);
    const secs = Number(parts[1]);
    if (!Number.isFinite(mins) || !Number.isFinite(secs)) return "invalid";
    if (mins < 0 || secs < 0 || secs >= 60) return "invalid";
    return mins * 60 + secs;
  }
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return n;
}

/**
 * Read a file into a plan. `knownIds` is the set of bug ids the importer
 * can actually see, so an id that belongs to nobody is an error rather
 * than a silent insert with someone else's identifier.
 */
export function planImport(text: string, knownIds: Set<string>): ImportPlan {
  const records = parseCsvRecords(text);
  const rows: ImportRow[] = [];

  const unknownColumns =
    records.length > 0
      ? Object.keys(records[0]).filter((c) => c && !KNOWN_COLUMNS.has(c))
      : [];

  records.forEach((record, index) => {
    const errors: string[] = [];
    // +2: one for the header, one because people count from 1.
    const line = index + 2;

    const title = (record.title ?? "").trim();
    if (!title) errors.push("title is empty");
    if (title.length > 200) errors.push("title is longer than 200 characters");

    const severity =
      fromLabel<BugSeverity>(record.severity ?? "", SEVERITY_LABEL) ??
      ((record.severity ?? "").trim() ? "invalid" : "major");
    if (severity === "invalid") {
      errors.push(`severity "${record.severity}" is not blocker, major or minor`);
    }

    const kind =
      fromLabel<BugKind>(record.kind ?? "", KIND_LABEL) ??
      ((record.kind ?? "").trim() ? "invalid" : "functional");
    if (kind === "invalid") {
      errors.push(`kind "${record.kind}" is not one we use`);
    }

    const area = areaFrom(record.area ?? "") ?? ((record.area ?? "").trim() ? "invalid" : "other");
    if (area === "invalid") {
      errors.push(`area "${record.area}" is not one we use`);
    }

    const id = (record.id ?? "").trim();
    if (id && !UUID.test(id)) {
      errors.push("id is not a valid identifier");
    } else if (id && !knownIds.has(id)) {
      errors.push("id does not match a bug you can edit");
    }

    const ref = parseMatchRef(record.match_id ?? "");
    if (!ref.ok) {
      errors.push("match_id is not a match id or a /match/ address");
    }
    const matchId = ref.ok ? ref.id : null;

    const seconds = parseVideoSeconds(record.video_seconds ?? "");
    if (seconds === "invalid") {
      errors.push(`video_seconds "${record.video_seconds}" is not a time`);
    }

    rows.push({
      line,
      action: errors.length ? "error" : id ? "update" : "create",
      errors,
      id: id || undefined,
      title,
      values: {
        title,
        steps: (record.steps ?? "").trim(),
        expected: (record.expected ?? "").trim(),
        actual: (record.actual ?? "").trim(),
        kind: kind === "invalid" ? "functional" : kind,
        area: area === "invalid" ? "other" : area,
        severity: severity === "invalid" ? "major" : severity,
        case_id: (record.case_id ?? "").trim(),
        match_id: matchId,
        video_seconds: seconds === "invalid" ? null : seconds,
        device: (record.device ?? "").trim(),
        url: (record.url ?? "").trim(),
      },
    });
  });

  return {
    rows,
    creates: rows.filter((r) => r.action === "create").length,
    updates: rows.filter((r) => r.action === "update").length,
    errors: rows.filter((r) => r.action === "error").length,
    unknownColumns,
  };
}
