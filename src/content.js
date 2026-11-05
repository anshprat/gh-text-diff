/*
 * Content script: finds paired deleted/added lines in GitHub diffs and
 * highlights only the changed words.
 *
 * It uses the CSS Custom Highlight API (CSS.highlights) instead of wrapping
 * text in <span>s. The page DOM is never modified, so GitHub's React diff
 * view cannot get out of sync, and our own work never triggers the
 * MutationObserver.
 */
(() => {
  'use strict';

  if (window.__ghWordDiffLoaded) return;
  window.__ghWordDiffLoaded = true;

  if (!globalThis.CSS || !CSS.highlights || typeof Highlight !== 'function') return;
  const { wordDiff } = globalThis.GhWordDiff;

  // Each view describes one GitHub diff layout. Rows are walked in DOM
  // order; consecutive rows with changed lines form one change block.
  const VIEWS = [
    {
      // New React "Files changed" view (/pull/N/changes, /commit/...).
      row: 'tr.diff-line-row',
      del: 'code.diff-text.deletion .diff-text-inner',
      add: 'code.diff-text.addition .diff-text-inner',
    },
    {
      // Classic view (/pull/N/files, logged-out pages, compare view).
      row: 'table.diff-table tr',
      del: 'td.blob-code-deletion .blob-code-inner',
      add: 'td.blob-code-addition .blob-code-inner',
    },
  ];

  // GitHub marks its own intra-line highlights with .x. content.css hides
  // them and this script re-highlights every pair, so all lines look the
  // same. When GitHub found a pair similar enough to highlight, never fall
  // back to "too different" for it.
  const GITHUB_WORD_HIGHLIGHT = '.x';
  const FORCE = { minSimilarity: 0 };

  const delHighlight = new Highlight();
  const addHighlight = new Highlight();
  CSS.highlights.set('gh-word-diff-del', delHighlight);
  CSS.highlights.set('gh-word-diff-add', addHighlight);

  // del element -> { add, delText, addText, diff, delRanges, addRanges }
  const cache = new WeakMap();

  function collectPairs() {
    const pairs = [];
    for (const view of VIEWS) {
      let table = null;
      let dels = [];
      let adds = [];
      const flush = () => {
        const n = Math.min(dels.length, adds.length);
        for (let i = 0; i < n; i++) pairs.push([dels[i], adds[i]]);
        dels = [];
        adds = [];
      };
      for (const row of document.querySelectorAll(view.row)) {
        const t = row.closest('table');
        if (t !== table) { flush(); table = t; }
        const d = row.querySelectorAll(view.del);
        const a = row.querySelectorAll(view.add);
        if (d.length === 0 && a.length === 0) { flush(); continue; }
        dels.push(...d);
        adds.push(...a);
      }
      flush();
    }
    return pairs;
  }

  // Map character ranges in root.textContent to DOM Ranges over text nodes.
  function toDomRanges(root, spans) {
    if (spans.length === 0) return [];
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let nodeStart = 0;
    for (const [s, e] of spans) {
      const range = document.createRange();
      while (node && nodeStart + node.data.length <= s) {
        nodeStart += node.data.length;
        node = walker.nextNode();
      }
      if (!node) break;
      range.setStart(node, s - nodeStart);
      while (node && nodeStart + node.data.length < e) {
        nodeStart += node.data.length;
        node = walker.nextNode();
      }
      if (!node) break;
      range.setEnd(node, e - nodeStart);
      out.push({ range, text: null });
    }
    for (const r of out) r.text = r.range.toString();
    return out;
  }

  // A cached Range goes stale when React or another extension replaces the
  // text nodes under it, even when the line text is the same.
  function rangesLive(list) {
    for (const r of list) if (r.range.toString() !== r.text) return false;
    return true;
  }

  function scan() {
    scheduled = false;
    const delRanges = [];
    const addRanges = [];

    for (const [del, add] of collectPairs()) {
      const delText = del.textContent;
      const addText = add.textContent;
      let entry = cache.get(del);
      const sameInput = entry && entry.add === add && entry.delText === delText && entry.addText === addText;
      if (!sameInput || !rangesLive(entry.delRanges) || !rangesLive(entry.addRanges)) {
        const githubHighlighted = del.querySelector(GITHUB_WORD_HIGHLIGHT) || add.querySelector(GITHUB_WORD_HIGHLIGHT);
        const diff = sameInput ? entry.diff : wordDiff(delText, addText, githubHighlighted ? FORCE : undefined);
        entry = {
          add,
          delText,
          addText,
          diff,
          delRanges: diff ? toDomRanges(del, diff.del) : [],
          addRanges: diff ? toDomRanges(add, diff.add) : [],
        };
        cache.set(del, entry);
      }
      for (const r of entry.delRanges) delRanges.push(r.range);
      for (const r of entry.addRanges) addRanges.push(r.range);
    }

    // Most scans are triggered by unrelated page changes. Skip the repaint
    // when the highlight set is the same as last time.
    if (sameList(delRanges, lastDel) && sameList(addRanges, lastAdd)) return;
    lastDel = delRanges;
    lastAdd = addRanges;
    delHighlight.clear();
    addHighlight.clear();
    for (const r of delRanges) delHighlight.add(r);
    for (const r of addRanges) addHighlight.add(r);
  }

  let lastDel = [];
  let lastAdd = [];
  function sameList(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(scan, 120);
  }

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  schedule();
})();
