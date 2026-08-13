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
