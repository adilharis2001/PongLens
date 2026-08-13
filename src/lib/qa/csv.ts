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
