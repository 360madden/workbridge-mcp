#!/usr/bin/env node
// OFFLINE, synthetic, in-memory only. Tests the JS replacement semantics used by
// Workbridge edit_file without importing/running src, dist, MCP, GUI or filesystem APIs.
// No filesystem reads/writes, process spawning, environment access, or network use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixture = (oldText, newText, original, encoding = 'utf8') => {
  // The independent expected text uses literal string pieces, never substitution.
  const expected = original.split(oldText).join(newText);
  const expectedBytes = Buffer.from(expected, encoding);
  const expectedHash = sha256(expectedBytes);
  const vulnerable = original.replaceAll(oldText, newText);
  const fixed = original.replaceAll(oldText, () => newText);
  return { expected, expectedHash, vulnerable, fixed, fixedHash: sha256(Buffer.from(fixed, encoding)) };
};

for (const token of [
  { name: 'suffix token', value: "$'", mustExpand: true },
  { name: 'prefix token', value: '$`', mustExpand: true },
  { name: 'match token', value: '$&', mustExpand: true },
  { name: 'escaped dollar token', value: '$$', mustExpand: true },
  { name: 'uncaptured numeric token remains literal', value: '$1', mustExpand: false },
  { name: 'uncaptured named token remains literal', value: '$<part>', mustExpand: false },
]) {
  test('replacement template: ' + token.name, () => {
    const r = fixture('<MARK>', token.value, 'START|<MARK>|END');
    assert.equal(r.fixed, r.expected);
    assert.equal(r.fixedHash, r.expectedHash);
    if (token.mustExpand) {
      assert.notEqual(r.vulnerable, r.expected, 'the original string-replacement bug must be reproduced');
    } else {
      assert.equal(r.vulnerable, r.expected, 'without capture groups this form is a literal control');
    }
  });
}

test('literal-dollar markers remain exact across two CRLF replacements', () => {
  const source = 'first\r\n<MARK>\r\nmiddle\r\n<MARK>\r\nlast\r\n';
  const insertion = "$'"; // This source line itself contains a literal replacement suffix token.
  const r = fixture('<MARK>', insertion, source);
  assert.equal(r.expected, "first\r\n$'\r\nmiddle\r\n$'\r\nlast\r\n");
  assert.equal(r.fixed, r.expected);
  assert.equal(r.fixedHash, r.expectedHash);
  assert.notEqual(r.vulnerable, r.expected);
  assert.equal((r.fixed.match(/\r\n/g) ?? []).length, 5);
});

test('PowerShell-comment fixture with mixed tokens, LF, and exact UTF-8 SHA', () => {
  const source = "Set-StrictMode -Version Latest\n# REPLACE\nWrite-Host 'done'\n";
  const insertion = "# literal JS tokens: $' $\x60 $& $$";
  const r = fixture('# REPLACE', insertion, source);
  assert.equal(r.fixed, r.expected);
  assert.equal(r.fixedHash, r.expectedHash);
  assert.notEqual(r.vulnerable, r.expected);
  assert.equal(r.fixed.endsWith("Write-Host 'done'\n"), true);
});

test('search string containing regex characters remains literal', () => {
  const r = fixture('[x](.)', '$&', 'left [x](.) right');
  assert.equal(r.expected, 'left $& right');
  assert.equal(r.fixed, r.expected);
  assert.equal(r.fixedHash, r.expectedHash);
  assert.notEqual(r.vulnerable, r.expected);
});

test('UTF-16LE synthetic payload preserves exact BOM+bytes/hash', () => {
  const source = '\uFEFFset foo\r\n<MARK>\r\n';
  const r = fixture('<MARK>', "$'", source, 'utf16le');
  assert.equal(r.fixed, r.expected);
  assert.equal(r.fixedHash, r.expectedHash);
  assert.equal(Buffer.from(r.fixed, 'utf16le').subarray(0, 2).toString('hex'), 'fffe');
  assert.notEqual(r.vulnerable, r.expected);
});

test('the single-source fixture has no access to Workbridge production state', () => {
  const r = fixture('UNIQUE', '$$', 'A UNIQUE Z');
  assert.equal(r.fixed, 'A $$ Z');
  assert.equal(r.fixedHash, sha256(Buffer.from('A $$ Z', 'utf8')));
});
