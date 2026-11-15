import { escHtml } from './util';

/**
 * A tab cannot wrap line by line: each string would break at its own place and the
 * strings would no longer line up. Instead the whole block is cut into vertical
 * slices that hold every line, preferably at bar lines. Each slice is an inline
 * block, so the browser moves whole slices to the next row like words, in one
 * column or two, at any font size.
 */

// A slice longer than this is cut again where nothing is played on any string.
const MAX_SLICE = 24;
// A slice this short (such as the string names "e|" before the first bar) joins the next.
const MIN_SLICE = 4;

const isWordChar = (ch: string | undefined) => !!ch && /\S/.test(ch);
// A line that is part of the tab itself rather than text above or below it.
const isTabString = (line: string) => (line.match(/-/g)?.length ?? 0) >= 3;

/**
 * Cuts the lines of one tab block into slices. Every slice holds the same column
 * range of every line, padded to equal width, so stacking a slice's lines keeps
 * them aligned. Joining the slices of each line gives back the line (padded).
 */
export function sliceTab(lines: readonly string[]): string[][] {
  const width = Math.max(0, ...lines.map((l) => l.length));
  const padded = lines.map((l) => l.padEnd(width, ' '));
  if (width === 0) return [padded];

  const strings = padded.filter(isTabString);
  // Without tab strings (a grid, say) every line with text has to agree on a bar.
  const barLines = strings.length ? strings : padded.filter((l) => l.trim());
  const others = padded.filter((l) => !barLines.includes(l));

  // Text lines (chord names above a tab, "x2") must not be cut inside a word.
  const textAllowsCutAfter = (c: number) => others.every((l) => !(isWordChar(l[c]) && isWordChar(l[c + 1])));
  const isBar = (c: number) => barLines.every((l) => l[c] === '|') && textAllowsCutAfter(c);
  // Nothing played on any string here, so a cut cannot split a fret number like 12.
  const isQuiet = (c: number) =>
    barLines.every((l) => l[c] === '-' || l[c] === ' ') &&
    barLines.every((l) => l[c + 1] === '-' || l[c + 1] === ' ' || l[c + 1] === '|' || l[c + 1] === undefined) &&
    textAllowsCutAfter(c);

  // Cut after these columns: first at bars, then inside slices that are still too long.
  const cuts: number[] = [];
  let start = 0;
  for (let c = 0; c < width - 1; c++) {
    if (isBar(c) && c + 1 - start >= MIN_SLICE) {
      cuts.push(c);
      start = c + 1;
    }
  }
  const fine: number[] = [];
  start = 0;
  for (const end of [...cuts, width - 1]) {
    let from = start;
    let lastQuiet = -1;
    for (let c = from; c < end; c++) {
      if (isQuiet(c) && c + 1 - from >= MIN_SLICE) lastQuiet = c;
      if (c + 1 - from >= MAX_SLICE && lastQuiet >= from) {
        fine.push(lastQuiet);
        from = lastQuiet + 1;
        lastQuiet = -1;
      }
    }
    if (end < width - 1) fine.push(end);
    start = end + 1;
  }

  const bounds = [-1, ...fine, width - 1];
  const slices: string[][] = [];
  for (let i = 1; i < bounds.length; i++) {
    slices.push(padded.map((l) => l.slice(bounds[i - 1] + 1, bounds[i] + 1)));
  }
  return slices;
}

/** One tab block as wrapping slices. No whitespace between them, so nothing adds a gap. */
export function renderTabBlock(lines: readonly string[]): string {
  const slices = sliceTab(lines.map((l) => l.replace(/\s+$/, '')))
    .map(
      (slice) =>
        `<span class="tab-slice">${slice.map((l) => `<span class="tab-line">${escHtml(l)}</span>`).join('')}</span>`,
    )
    .join('');
  return `<div class="tab-block">${slices}</div>`;
}
