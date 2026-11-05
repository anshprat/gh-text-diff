# GitHub Word Diff

A Chrome extension for GitHub pull request diffs. It highlights only the
changed words in a changed line, also when the line is very long.

GitHub skips word-level highlights on long lines. A one-sentence edit in a
3,000-character line (for example, a prompt stored as one JSON string) then
shows as a fully red line and a fully green line. This extension diffs each
deleted/added line pair word by word and colours only the changed words.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Open or reload a PR's **Files changed** page.

No permissions are needed. The extension runs only on `https://github.com/*`.

## What it does

- Works in GitHub's new React diff view (`/pull/N/changes`) and the classic
  view (`/pull/N/files`, commits, compare). Works in split and unified mode.
- Pairs the deleted and added lines of each change block in order, the same
  way GitHub does.
- Diffs each pair by words (Myers diff over word, whitespace and punctuation
  tokens). Escaped newlines (`\n` inside JSON strings) count as line breaks,
  so a highlight starts and ends at clean phrase edges.
- Replaces GitHub's own word highlights (`.x`), so all lines use the same
  colours.
- Skips a pair when less than 30% of the text is unchanged. Exception: a
  pair that GitHub already word-highlighted is always diffed.

The highlights use the
[CSS Custom Highlight API](https://developer.mozilla.org/docs/Web/API/CSS_Custom_Highlight_API).
The extension never changes the page DOM, so GitHub's React view and other
extensions (for example Refined GitHub) are not affected.

## Change the colours

Edit the two variables at the top of `src/content.css`:

```css
:root {
  --gh-word-diff-del-bg: ...;
  --gh-word-diff-add-bg: ...;
}
```

## Develop

```sh
npm test          # unit tests for the word diff (node:test, no install)
npm run package   # zip for the Chrome Web Store
```

| File | Purpose |
| --- | --- |
| `src/diff.js` | Pure word diff. No DOM. |
| `src/content.js` | Finds line pairs, maps character ranges to DOM ranges, keeps highlights current with a `MutationObserver`. |
| `src/content.css` | Highlight colours. Hides GitHub's `.x` word highlights. |
