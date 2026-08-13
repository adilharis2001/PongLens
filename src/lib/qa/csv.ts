/**
 * CSV writing for the testing portal.
 *
 * The library and the bug table both leave here as spreadsheets, because
 * run tracking lives in the tester's own sheet rather than in the product.
 * Steps and expected results are multi-line, so quoting is not optional
 * decoration here: get it wrong and every row after the first break lands
 * in the wrong column.
 *
 * RFC 4180 with two deliberate additions:
 *
 *  - A UTF-8 byte order mark, so Excel opens the file as UTF-8 instead of
 *    guessing a legacy code page and mangling anything non-ASCII.
 *  - Formula neutering. A spreadsheet treats a cell starting with =, +, -
 *    or @ as a formula, so text typed by a person can become executable
 *    when someone else opens the file. Bug titles are typed by a person.
 */

/** Excel and Sheets both agree on CRLF, and CRLF survives either. */
const EOL = "\r\n";

export const CSV_BOM = "﻿";

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);

  // Neuter before quoting, so the guard character ends up inside the
  // quotes rather than outside them.
  if (FORMULA_START.test(text)) text = `'${text}`;

  if (NEEDS_QUOTING.test(text) || text !== text.trim()) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

/**
 * A whole document. `rows` are written in the order given: the caller
 * decides the sort, because the sheet's order is the order someone works
 * through it.
 */
export function csvDocument(header: string[], rows: unknown[][]): string {
  return (
    CSV_BOM +
    [csvRow(header), ...rows.map(csvRow)].join(EOL) +
    // A trailing newline: some tools drop the last row without it.
    EOL
  );
}

/** A list becomes one cell, one item per line, so it stays readable. */
export function csvList(items: readonly string[] | undefined): string {
  if (!items || items.length === 0) return "";
  return items.join("\n");
}

/** Numbered, for steps, where the order is the meaning. */
export function csvNumberedList(items: readonly string[] | undefined): string {
  if (!items || items.length === 0) return "";
  return items.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

/** Content-Disposition value for a download with a sensible file name. */
export function csvAttachment(name: string): string {
  return `attachment; filename="${name.replace(/[^a-zA-Z0-9._-]/g, "-")}"`;
}

/**
 * Reading a CSV back.
 *
 * Hand-rolled rather than a dependency, because the format is small and
 * the risk is not parsing, it is a parser that quietly does the wrong
 * thing with a quoted newline. Steps and expected results are multi-line
 * by design, so a naive split on newlines turns one bug into four
 * fragments and reports three of them as errors.
 *
 * Handles: quoted fields, embedded commas, embedded newlines, doubled
 * quotes as an escape, CRLF or LF, a leading BOM, and the formula guard
 * this module writes on the way out.
 */
export function parseCsv(text: string): string[][] {
  let src = text;
  if (src.startsWith(CSV_BOM)) src = src.slice(CSV_BOM.length);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A trailing newline should not invent a final empty record.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i];

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field === "") {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // CRLF or a lone CR both end the record.
      if (src[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * Undo the formula guard so a round trip is lossless. A cell we wrote as
 * '=1+1 came from a person typing =1+1, and importing it back as '=1+1
 * would grow an apostrophe on every trip through a spreadsheet.
 */
export function unguard(value: string): string {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1))
    ? value.slice(1)
    : value;
}

/**
 * Rows keyed by the header, with the header lowercased and trimmed so a
 * spreadsheet that title-cased the columns still imports. Cells are
 * unguarded and trimmed of the whitespace a spreadsheet adds.
 */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    header.forEach((key, idx) => {
      record[key] = unguard((row[idx] ?? "").trim());
    });
    return record;
  });
}
