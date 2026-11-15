import { renderTabBlock, sliceTab } from '../tabLayout';

const join = (slices: string[][]) => slices[0].map((_, i) => slices.map((s) => s[i]).join(''));
const widthsAgree = (slices: string[][]) => slices.every((s) => s.every((l) => l.length === s[0].length));

describe('sliceTab', () => {
  it('cuts after bar lines, keeping the string names with the first bar', () => {
    const tab = ['e|--0--|--3--|', 'B|--1--|--0--|'];
    expect(sliceTab(tab)).toEqual([
      ['e|--0--|', 'B|--1--|'],
      ['--3--|', '--0--|'],
    ]);
  });

  it('gives back the lines when the slices are joined', () => {
    const tab = ['e|-----0---3---|-----0-------|', 'B|---1---0-----|---0---1---0-|', 'G|-2-----------|-0-----------|'];
    const slices = sliceTab(tab);
    expect(join(slices)).toEqual(tab);
    expect(widthsAgree(slices)).toBe(true);
  });

  it('pads lines of different length so the slices stay aligned', () => {
    const tab = ['e|--0--|--3--|', 'B|--1--|'];
    const slices = sliceTab(tab);
    expect(widthsAgree(slices)).toBe(true);
    expect(join(slices).map((l) => l.trimEnd())).toEqual(tab);
  });

  it('only cuts at a bar that every string has in the same place', () => {
    const tab = ['e|--0--|--3--|', 'B|--1----0---|'];
    expect(sliceTab(tab)).toHaveLength(1);
  });

  it('cuts a long bar-less tab where nothing is played, never inside a fret number', () => {
    const tab = [
      'e|--0----3----5----7----8----10---12---10---8----7----|',
      'B|---------------------------------------------------|',
    ];
    const slices = sliceTab(tab);
    expect(slices.length).toBeGreaterThan(1);
    expect(join(slices)).toEqual(tab.map((l) => l.padEnd(tab[0].length)));
    const cuts = slices.slice(0, -1).map((s) => s[0].at(-1));
    for (const last of cuts) expect(last).toBe('-');
    for (const s of slices) expect(s[0].length).toBeLessThanOrEqual(24);
  });

  it('does not cut a chord name written above the tab', () => {
    // "Am" sits across the bar at column 7, so the tab is not cut there.
    const tab = ['       Am', 'e|--0--|--3--|', 'B|--1--|--0--|'];
    expect(sliceTab(tab)).toHaveLength(1);
  });

  it('cuts beside a chord name above the tab', () => {
    const tab = ['    Am   C', 'e|--0--|--3--|', 'B|--1--|--0--|'];
    const slices = sliceTab(tab);
    expect(slices).toHaveLength(2);
    expect(join(slices).map((l) => l.trimEnd())).toEqual(tab);
  });

  it('cuts a chord grid at its bars', () => {
    const grid = ['| C . . . | G . . . | Am . . . | F . . . |'];
    expect(sliceTab(grid).length).toBeGreaterThan(1);
    expect(join(sliceTab(grid))).toEqual(grid);
  });

  it('copes with an empty block', () => {
    expect(sliceTab([''])).toEqual([['']]);
  });
});

describe('renderTabBlock', () => {
  it('writes slices with no whitespace between them', () => {
    const html = renderTabBlock(['e|--0--|--3--|', 'B|--1--|--0--|']);
    expect(html).toBe(
      '<div class="tab-block">' +
        '<span class="tab-slice"><span class="tab-line">e|--0--|</span><span class="tab-line">B|--1--|</span></span>' +
        '<span class="tab-slice"><span class="tab-line">--3--|</span><span class="tab-line">--0--|</span></span>' +
        '</div>',
    );
  });

  it('escapes the text', () => {
    expect(renderTabBlock(['e|-<x>-&-|'])).toContain('e|-&lt;x&gt;-&amp;-|');
  });
});
