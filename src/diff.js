/*
 * Word-level diff for two lines of text.
 *
 * Pure functions, no DOM. Loaded as a classic content script (exposes
 * globalThis.GhWordDiff) and as a CommonJS module for the node tests.
 */
(function (root) {
  'use strict';

  // A token is an escaped newline/tab ("\n" written as two characters, as in
  // JSON strings), a run of word characters, a run of whitespace, or one
  // other character. Every character falls into exactly one token, so the
  // tokens always concatenate back to the input.
  const TOKEN_RE = /\\[nrt]|[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
  const WS_RE = /^\s+$/;
  const ESC_NL_RE = /^\\[nr]$/;

  const DEFAULTS = {
    // Give up (return null) when the edit script is longer than this many
    // tokens. Protects the page from pathological inputs.
    maxEdits: 2000,
    // Return null when less than this share of the characters is unchanged.
    // At that point the whole-line highlight is the honest answer.
    minSimilarity: 0.3,
  };

  function tokenize(text) {
    const tokens = [];
    TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = TOKEN_RE.exec(text)) !== null) tokens.push(m[0]);
    return tokens;
  }

  /*
   * Myers O(ND) diff over a[aLo..aHi) and b[bLo..bHi).
   * Marks changed tokens in delA / insB. Returns false if the edit
   * distance exceeds maxEdits.
   */
  function myers(a, aLo, aHi, b, bLo, bHi, delA, insB, maxEdits) {
    const n = aHi - aLo;
    const m = bHi - bLo;
    const max = n + m;
    if (max === 0) return true;
    const limit = Math.min(max, maxEdits);
    const off = limit + 1;
    const v = new Int32Array(2 * limit + 3);
    const trace = [];

    for (let d = 0; d <= limit; d++) {
      // Snapshot of k in [-d-1, d+1] taken before round d.
      trace.push(v.slice(off - d - 1, off + d + 2));
      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) {
          x = v[off + k + 1];
        } else {
          x = v[off + k - 1] + 1;
        }
        let y = x - k;
        while (x < n && y < m && a[aLo + x] === b[bLo + y]) { x++; y++; }
        v[off + k] = x;
        if (x >= n && y >= m) {
          backtrack(trace, n, m, aLo, bLo, delA, insB);
          return true;
        }
      }
    }
    return false;
  }

  function backtrack(trace, n, m, aLo, bLo, delA, insB) {
    let x = n;
    let y = m;
    for (let d = trace.length - 1; d > 0; d--) {
      const snap = trace[d];
      const at = (k) => snap[k + d + 1];
      const k = x - y;
      const prevK = (k === -d || (k !== d && at(k - 1) < at(k + 1))) ? k + 1 : k - 1;
      const prevX = at(prevK);
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) { x--; y--; }
      if (x === prevX) insB[bLo + prevY] = 1;
      else delA[aLo + prevX] = 1;
      x = prevX;
      y = prevY;
    }
  }

  // How good a place is the gap between token l and token r for a highlight
  // edge? Higher is better. Same scale as diff-match-patch's semantic score.
  function boundaryScore(l, r) {
    if (l === undefined || r === undefined) return 6; // edge of the line
    const c1 = l[l.length - 1];
    const c2 = r[0];
    const nonWord1 = !/[\p{L}\p{N}_]/u.test(c1);
    const nonWord2 = !/[\p{L}\p{N}_]/u.test(c2);
    const ws1 = /\s/.test(c1);
    const ws2 = /\s/.test(c2);
    if (ESC_NL_RE.test(l) || ESC_NL_RE.test(r) || /[\r\n]/.test(c1) || /[\r\n]/.test(c2)) return 4;
    if (nonWord1 && !ws1 && ws2) return 3; // end of sentence / clause
    if (ws1 || ws2) return 2;
    if (nonWord1 || nonWord2) return 1;
    return 0;
  }

  /*
   * A run of changed tokens can often slide left or right without changing
   * the diff (e.g. inserting " Rule 7." before " Rule 6."). Myers picks one
   * position arbitrarily. Move each run to the position with the cleanest
   * edges, so the highlight covers whole phrases.
   */
  function slideRuns(tokens, flags) {
    const n = tokens.length;
    let i = 0;
    while (i < n) {
      if (!flags[i]) { i++; continue; }
      let s = i;
      let e = i;
      while (e < n && flags[e]) e++;
      const len = e - s;
      for (let t = s; t < e; t++) flags[t] = 0;
      while (s > 0 && !flags[s - 1] && tokens[s - 1] === tokens[e - 1]) { s--; e--; }
      let bestS = s;
      let bestScore = -1;
      for (;;) {
        const score = boundaryScore(tokens[s - 1], tokens[s]) + boundaryScore(tokens[e - 1], tokens[e]);
        if (score > bestScore) { bestScore = score; bestS = s; }
        if (e < n && !flags[e] && tokens[e] === tokens[s]) { s++; e++; } else break;
      }
      for (let t = bestS; t < bestS + len; t++) flags[t] = 1;
      i = bestS + len;
    }
  }

  /*
   * Turn per-token change flags into character ranges [start, end).
   * Changed runs separated only by whitespace merge into one range.
   * Leading and trailing whitespace is trimmed from each range.
   */
  function toRanges(tokens, flags) {
    const ranges = [];
    let pos = 0;
    let cur = null;
    let gapStart = -1; // start of a whitespace-only gap after cur
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const end = pos + t.length;
      if (flags[i]) {
        if (cur && gapStart !== -1) cur[1] = end; // bridge the whitespace gap
        else if (cur && cur[1] === pos) cur[1] = end;
        else { cur = [pos, end]; ranges.push(cur); }
        gapStart = -1;
      } else if (cur && WS_RE.test(t) && (gapStart !== -1 || cur[1] === pos)) {
        if (gapStart === -1) gapStart = pos;
      } else {
        cur = null;
        gapStart = -1;
      }
      pos = end;
    }
    return ranges;
  }

  function trimRanges(text, ranges) {
    const out = [];
    for (const [s0, e0] of ranges) {
      let s = s0;
      let e = e0;
      while (s < e && /\s/.test(text[s])) s++;
      while (e > s && /\s/.test(text[e - 1])) e--;
      out.push(s < e ? [s, e] : [s0, e0]); // keep pure-whitespace changes
    }
    return out;
  }

  function sumLen(ranges) {
    let n = 0;
    for (const [s, e] of ranges) n += e - s;
    return n;
  }

  /*
   * Compare two lines. Returns { del: [[s,e]...], add: [[s,e]...] } with
   * character ranges into oldText and newText, or null when the lines are
   * too different (or too expensive) for a useful word-level highlight.
   */
  function wordDiff(oldText, newText, options) {
    const opts = Object.assign({}, DEFAULTS, options);
    if (oldText === newText) return { del: [], add: [] };

    const a = tokenize(oldText);
    const b = tokenize(newText);

    // Strip the common prefix and suffix first. For a long line with one
    // small edit this does nearly all the work.
    let lo = 0;
    while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
    let aHi = a.length;
    let bHi = b.length;
    while (aHi > lo && bHi > lo && a[aHi - 1] === b[bHi - 1]) { aHi--; bHi--; }

    const delA = new Uint8Array(a.length);
    const insB = new Uint8Array(b.length);
    if (!myers(a, lo, aHi, b, lo, bHi, delA, insB, opts.maxEdits)) return null;
    slideRuns(a, delA);
    slideRuns(b, insB);

    const del = trimRanges(oldText, toRanges(a, delA));
    const add = trimRanges(newText, toRanges(b, insB));

    const total = oldText.length + newText.length;
    const changed = sumLen(del) + sumLen(add);
    if (total > 0 && (total - changed) / total < opts.minSimilarity) return null;

    return { del, add };
  }

  const api = { tokenize, wordDiff, DEFAULTS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GhWordDiff = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
