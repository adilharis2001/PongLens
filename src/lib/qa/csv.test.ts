import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CSV_BOM,
  csvAttachment,
  csvCell,
  csvDocument,
  csvList,
  csvNumberedList,
  csvRow,
  parseCsv,
  parseCsvRecords,
  unguard,
} from "./csv.ts";

test("plain values are written bare", () => {
  assert.equal(csvCell("upload-file-happy"), "upload-file-happy");
  assert.equal(csvCell(12), "12");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("commas, quotes and newlines are quoted", () => {
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line one\nline two"), '"line one\nline two"');
  assert.equal(csvCell("has\r\nboth"), '"has\r\nboth"');
});

test("leading and trailing space survives a round trip", () => {
  // Unquoted, most parsers trim it and the cell silently changes.
  assert.equal(csvCell(" padded "), '" padded "');
});

test("a cell that looks like a formula cannot execute", () => {
  // This is the one that matters: bug titles are typed by a person and
  // opened in Excel by someone else.
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("+44 7700 900000"), "'+44 7700 900000");
  assert.equal(csvCell("-1"), "'-1");
  assert.equal(csvCell("@here"), "'@here");
  assert.equal(csvCell("=HYPERLINK(\"http://x\")"), "\"'=HYPERLINK(\"\"http://x\"\")\"");
});

test("a formula that also needs quoting keeps the guard inside the quotes", () => {
  const out = csvCell("=SUM(A1,A2)");
  assert.ok(out.startsWith('"\''), `guard escaped the quotes: ${out}`);
  assert.ok(out.endsWith('"'));
});

test("rows join with commas", () => {
  assert.equal(csvRow(["a", "b,c", 3]), 'a,"b,c",3');
});

test("a document starts with a BOM and uses CRLF between rows", () => {
  const doc = csvDocument(["id", "title"], [["a", "one"], ["b", "two"]]);
  assert.ok(doc.startsWith(CSV_BOM), "missing BOM");
  const body = doc.slice(CSV_BOM.length);
  assert.equal(body, "id,title\r\na,one\r\nb,two\r\n");
});

test("a multiline cell does not break the row count", () => {
  const doc = csvDocument(
    ["id", "steps"],
    [["upload-file-happy", "1. Open\n2. Tap\n3. Wait"]],
  );
  const body = doc.slice(CSV_BOM.length);
  // Two records, even though the second contains two embedded newlines.
  // Splitting on the record separator is the check a naive parser fails.
  assert.equal(body.split("\r\n").filter(Boolean).length, 2);
  assert.ok(body.includes('"1. Open\n2. Tap\n3. Wait"'));
});

test("lists become one readable cell", () => {
  assert.equal(csvList(["a", "b"]), "a\nb");
  assert.equal(csvList([]), "");
  assert.equal(csvList(undefined), "");
  assert.equal(csvNumberedList(["first", "second"]), "1. first\n2. second");
});

test("the download file name is sanitised", () => {
  assert.equal(csvAttachment("bugs.csv"), 'attachment; filename="bugs.csv"');
  assert.equal(
    csvAttachment('a"b/c.csv'),
    'attachment; filename="a-b-c.csv"',
  );
});

// ---------------------------------------------------------------------------
// Reading back
// ---------------------------------------------------------------------------

test("a plain document parses into rows", () => {
  assert.deepEqual(parseCsv("a,b\n1,2\n"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("quoted fields keep their commas, quotes and newlines", () => {
  assert.deepEqual(parseCsv('a,"b,c"\n'), [["a", "b,c"]]);
  assert.deepEqual(parseCsv('a,"say ""hi"""\n'), [["a", 'say "hi"']]);
  assert.deepEqual(parseCsv('a,"one\ntwo"\n'), [["a", "one\ntwo"]]);
});

test("a quoted newline does not split the record", () => {
  // The failure this exists for: a naive split on newlines turns one bug
  // into four fragments and reports three of them as errors.
  const rows = parseCsv('id,steps\n,"1. Open\n2. Tap\n3. Wait"\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][1], "1. Open\n2. Tap\n3. Wait");
});

test("CRLF, LF and a BOM all parse the same", () => {
  const want = [
    ["a", "b"],
    ["1", "2"],
  ];
  assert.deepEqual(parseCsv("a,b\r\n1,2\r\n"), want);
  assert.deepEqual(parseCsv("a,b\n1,2"), want);
  assert.deepEqual(parseCsv(CSV_BOM + "a,b\r\n1,2\r\n"), want);
});

test("an empty document is empty rather than one blank row", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("\n"), []);
});

test("the formula guard is removed on the way back in", () => {
  assert.equal(unguard("'=1+1"), "=1+1");
  assert.equal(unguard("'@here"), "@here");
  // An apostrophe that is just an apostrophe stays put.
  assert.equal(unguard("'tis"), "'tis");
  assert.equal(unguard("plain"), "plain");
});

test("what we write is what we read: a full round trip", () => {
  const original = [
    ["upload-file-happy", "1. Open\n2. Tap", "=1+1", 'has "quotes", and a comma'],
    ["match-seek", "", " padded ", ""],
  ];
  const doc = csvDocument(["id", "steps", "title", "notes"], original);
  const back = parseCsv(doc).slice(1).map((row) => row.map(unguard));
  assert.deepEqual(back, original);
});

test("records are keyed by a header that may have been title-cased", () => {
  const records = parseCsvRecords('ID,Title ,SEVERITY\nx,Clip stalls,major\n');
  assert.deepEqual(records, [
    { id: "x", title: "Clip stalls", severity: "major" },
  ]);
});

test("a short row leaves the missing columns empty rather than undefined", () => {
  const records = parseCsvRecords("id,title,severity\n,Clip stalls\n");
  assert.deepEqual(records, [{ id: "", title: "Clip stalls", severity: "" }]);
});
