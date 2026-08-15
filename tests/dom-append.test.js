/**
 * A trap this codebase has fallen into three times.
 *
 * `el()` filters null children, so `el('p', {}, cond ? x : null)` is safe and
 * is used everywhere. `Node.append` does not — it stringifies null into the
 * literal text "null", which then appears on the page. The two read
 * identically at the call site, which is exactly why the mistake keeps
 * happening: it is invisible in review and only shows up as the word "null"
 * sitting in the middle of a screen.
 *
 * So this reads the source rather than the behaviour. Conditional children
 * belong inside an `el(...)`, or behind an `if` — never as a bare argument to
 * `.append`.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.js') ? [path] : [];
  });
}

/** Splits a call's argument list on top-level commas. */
function topLevelArguments(body) {
  const args = [];
  let depth = 0;
  let current = '';
  let quote = null;

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quote) {
      if (char === quote && body[i - 1] !== '\\') quote = null;
      current += char;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    if ('([{'.includes(char)) depth++;
    if (')]}'.includes(char)) depth--;
    if (char === ',' && depth === 0) {
      args.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  args.push(current);
  return args;
}

/** Every `.append(...)` call in a source file, with its argument list. */
function appendCalls(source) {
  const calls = [];
  const pattern = /(\w+)\.append\(/g;
  let match;
  while ((match = pattern.exec(source))) {
    let i = pattern.lastIndex;
    let depth = 1;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
      i++;
    }
    calls.push({ receiver: match[1], body: source.slice(pattern.lastIndex, i - 1), index: match.index });
  }
  return calls;
}

describe('Node.append never receives a conditional null', () => {
  const files = sourceFiles(SRC);

  it('finds the source to check', () => {
    assert.ok(files.length > 10, `only found ${files.length} source files`);
  });

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const calls = appendCalls(source);
    if (calls.length === 0) continue;

    it(file.slice(file.indexOf('/src/') + 1), () => {
      for (const call of calls) {
        for (const argument of topLevelArguments(call.body)) {
          const trimmed = argument.trim();
          if (trimmed === '') continue;
          const line = source.slice(0, call.index).split('\n').length;
          assert.ok(
            !/:\s*null$/.test(trimmed) && trimmed !== 'null',
            `${file}:${line} appends a conditional null — it will render as the text "null". ` +
              `Wrap it in el(...) or put it behind an if.\n  ${trimmed.slice(0, 120)}`,
          );
        }
      }
    });
  }
});
