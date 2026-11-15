import * as ChordSheetJS from 'chordsheetjs';
import {
  detectFormat,
  ensureKeyDirective,
  extractDirective,
  maskTabs,
  parseSongAuto,
  renderChordPro,
  toChordPro,
} from '../chords';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import { chordProLanguage } from '../chordpro-lang';
import { chordProblems } from '../chordProblems';
import { chordCompletionSource } from '../chordCompletion';
import { insideTab } from '../chordTokens';

const TAB = ['e|-----0---3---|', 'B|---1---0-----|', 'G|-2-----------|'];
const TAB_SONG = `{title: Tab test}\n{key: G}\n\n{start_of_verse}\n[G]Some [C]words\n{end_of_verse}\n\n{start_of_tab}\n${TAB.join('\n')}\n{end_of_tab}`;

// The lines of each rendered tab block, put back together from its slices.
const tabBlocks = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return [...root.querySelectorAll('.tab-block')].map((block) => {
    const slices = [...block.querySelectorAll('.tab-slice')].map((s) =>
      [...s.querySelectorAll('.tab-line')].map((l) => l.textContent ?? ''),
    );
    return slices[0].map((_, i) =>
      slices
        .map((s) => s[i])
        .join('')
        .replace(/\s+$/, ''),
    );
  });
};

describe('renderChordPro tab sections', () => {
  it('shows every tab line verbatim in a tab block', () => {
    expect(tabBlocks(renderChordPro(TAB_SONG))).toEqual([TAB]);
  });

  it('gives the tab section a heading', () => {
    expect(renderChordPro(TAB_SONG)).toContain(
      '<div class="paragraph tab"><div class="row"><h3 class="label">Tab</h3>',
    );
  });

  it('uses the label written on the directive', () => {
    const html = renderChordPro(`{start_of_tab: Intro riff}\n${TAB[0]}\n{end_of_tab}`);
    expect(html).toContain('class="label">Intro riff</h3>');
  });

  it('accepts the short {sot}/{eot} directives', () => {
    expect(tabBlocks(renderChordPro(`{sot}\n${TAB[1]}\n{eot}`))).toEqual([[TAB[1]]]);
  });

  it('keeps inner spacing', () => {
    const line = 'e|--0--|    |--3--|';
    expect(tabBlocks(renderChordPro(`{start_of_tab}\n${line}\n{end_of_tab}`))).toEqual([[line]]);
  });

  it('escapes tab text', () => {
    const html = renderChordPro('{start_of_tab}\ne|--<b>0</b>--&|\n{end_of_tab}');
    expect(html).not.toContain('<b>0</b>');
    expect(tabBlocks(html)).toEqual([['e|--<b>0</b>--&|']]);
  });

  it('starts a new block after a blank line in the tab section', () => {
    const html = renderChordPro(`{start_of_tab}\n${TAB.join('\n')}\n\n${TAB.join('\n')}\n{end_of_tab}`);
    expect(tabBlocks(html)).toEqual([TAB, TAB]);
  });

  it('leaves tab lines alone when transposing', () => {
    const html = renderChordPro(TAB_SONG, 2);
    expect(tabBlocks(html)).toEqual([TAB]);
    expect(html).toContain('>A<');
  });

  it('leaves tab lines alone in number notation', () => {
    const html = renderChordPro(TAB_SONG, 0, true);
    expect(tabBlocks(html)).toEqual([TAB]);
    expect(html).toContain('>1<');
  });

  it('cuts a long tab into slices that hold every string', () => {
    const long = [
      'e|-----0---3---|-----0-------|---3---0-----|-------------|',
      'B|---1---0-----|---0---1---0-|-1---0---1---|---0---------|',
      'G|-2-----------|-0-----------|-------------|-0-----------|',
    ];
    const html = renderChordPro(`{start_of_tab}\n${long.join('\n')}\n{end_of_tab}`);
    const root = document.createElement('div');
    root.innerHTML = html;
    const slices = root.querySelectorAll('.tab-block .tab-slice');
    expect(slices.length).toBe(4);
    for (const slice of slices) expect(slice.querySelectorAll('.tab-line').length).toBe(3);
    expect(tabBlocks(html)).toEqual([long]);
  });
});

const STRINGS = [
  'e|-----0---3---|',
  'B|---1---0-----|',
  'G|-2-----------|',
  'D|-------------|',
  'A|-------------|',
  'E|-------------|',
];
const tabSection = (label?: string) =>
  [label ? `{start_of_tab: ${label}}` : '{start_of_tab}', ...STRINGS, '{end_of_tab}'].join('\n');
const pairs = (song: ChordSheetJS.Song) =>
  song.paragraphs
    .flatMap((p) => p.lines.flatMap((l) => l.items))
    .filter((it): it is ChordSheetJS.ChordLyricsPair => it instanceof ChordSheetJS.ChordLyricsPair);
const chordsOf = (song: ChordSheetJS.Song) =>
  pairs(song)
    .map((it) => it.chords)
    .filter(Boolean);
const tabLinesOf = (song: ChordSheetJS.Song) =>
  song.paragraphs
    .filter((p) => p.type === 'tab')
    .map((p) =>
      p.lines
        .flatMap((l) => l.items)
        .filter((it) => it instanceof ChordSheetJS.Literal)
        .map((it) => (it as ChordSheetJS.Literal).string),
    );

describe('tab blocks on import', () => {
  it('turns an Ultimate Guitar [Tab] section into a tab section', () => {
    const ug = `[Verse]\nG          C\nSome words here\n\n[Tab]\n${STRINGS.join('\n')}\n\n[Chorus]\nD          G\nMore words here`;
    expect(detectFormat(ug)).toBe('Ultimate Guitar');
    const pro = toChordPro(ug);
    expect(pro).toContain(tabSection());
    expect(pro).not.toContain('[B|');
    expect(pro).not.toContain('{comment: Tab}');
    expect(pro).toContain('{start_of_chorus: Chorus}');
  });

  it('labels a tab with the Ultimate Guitar heading above it', () => {
    const ug = `[Intro]\n${STRINGS.join('\n')}\n\n[Verse]\nG          C\nSome words here`;
    const pro = toChordPro(ug);
    expect(pro).toContain(tabSection('Intro'));
    expect(pro).not.toContain('start_of_part');
  });

  it('drops a raw Ultimate Guitar [/tab] closing tag after the tab', () => {
    const pro = toChordPro(`[tab]\n${STRINGS.join('\n')}\n[/tab]\n\nG          C\nSome words here`);
    expect(pro).toContain(tabSection());
    expect(pro).not.toContain('[/tab]');
  });

  it('finds a tab in chords-over-lyrics text', () => {
    const text = `G          C\nSome words here\n\n${STRINGS.join('\n')}\n\nD          G\nMore words here`;
    expect(detectFormat(text)).not.toBe('ChordPro');
    const song = parseSongAuto(text)!;
    expect(tabLinesOf(song)).toEqual([STRINGS]);
    expect(chordsOf(song)).toEqual(['G', 'C', 'D', 'G']);
  });

  it('names a tab after a "Solo:" line in chords-over-lyrics text', () => {
    const pro = toChordPro(`G          C\nSome words here\n\nSolo:\n${STRINGS.join('\n')}`);
    expect(pro).toContain(tabSection('Solo'));
  });

  it('keeps spacing inside a tab line', () => {
    const spaced = ['e|--0--|    |--3--|', 'B|--1--|    |--0--|'];
    const song = parseSongAuto(`G          C\nSome words here\n\n${spaced.join('\n')}`)!;
    expect(tabLinesOf(song)).toEqual([spaced]);
  });

  it('leaves bar-line chord charts as chords', () => {
    const song = parseSongAuto('| G | C | D | G |\n| Em | C | D | D |\nG          C\nSome words here')!;
    expect(song.paragraphs.some((p) => p.type === 'tab')).toBe(false);
  });

  it('needs at least two tab lines', () => {
    const song = parseSongAuto('G          C\nSome words here\ne|-----0---3---|\nD          G\nMore words here')!;
    expect(song.paragraphs.some((p) => p.type === 'tab')).toBe(false);
  });

  it('does not take the key from a string name', () => {
    const pro = ensureKeyDirective(toChordPro(`${STRINGS.join('\n')}\n\nD          G\nMore words here`));
    expect(extractDirective(pro, 'key')).toBe('D');
  });

  it('parses a song that is only a tab as ChordPro', () => {
    const song = parseSongAuto(tabSection())!;
    expect(tabLinesOf(song)).toEqual([STRINGS]);
    expect(chordsOf(song)).toEqual([]);
  });

  it('wraps bare tab lines between ChordPro sections', () => {
    const pro = toChordPro(`{start_of_verse}\n[G]Some [C]words\n{end_of_verse}\n\n${STRINGS.join('\n')}`);
    expect(pro).toContain(tabSection());
  });

  it('leaves bare tab lines inside a ChordPro section where they are', () => {
    const content = `{start_of_verse}\n[G]Some [C]words\n${STRINGS.join('\n')}\n{end_of_verse}`;
    expect(toChordPro(content)).not.toContain('{start_of_tab}');
  });

  it('keeps an existing tab section unchanged', () => {
    const content = `{key: G}\n[G]Some [C]words\n\n${tabSection('Riff')}`;
    expect(toChordPro(content)).toContain(tabSection('Riff'));
  });

  it('leaves content without tabs untouched', () => {
    const text = '[Verse]\nG          C\nSome words here';
    expect(maskTabs(text)).toEqual({ masked: text, blocks: [] });
  });
});

describe('tab blocks in the editor', () => {
  // Lezer's stock classHighlighter has no class for monospace, so name the tags in use here.
  const classHighlighter = tagHighlighter([
    { tag: tags.keyword, class: 'tok-keyword' },
    { tag: tags.heading, class: 'tok-heading' },
    { tag: tags.monospace, class: 'tok-monospace' },
  ]);
  // Each highlighted span as [text, class], from the language's own parse.
  const spans = (doc: string) => {
    const tree = chordProLanguage.parser.parse(doc);
    const out: [string, string][] = [];
    highlightTree(tree, classHighlighter, (from, to, cls) => out.push([doc.slice(from, to), cls]));
    return out;
  };

  it('marks tab lines as one monospace span and the directives as headings', () => {
    const doc = '[G]Words\n{start_of_tab: Intro}\nB|--[0]--|\n{end_of_tab}\n[C]After';
    expect(spans(doc)).toEqual([
      ['[G]', 'tok-keyword'],
      ['{start_of_tab: Intro}', 'tok-heading'],
      ['B|--[0]--|', 'tok-monospace'],
      ['{end_of_tab}', 'tok-heading'],
      ['[C]', 'tok-keyword'],
    ]);
  });

  it('treats {sot} and {eot} the same way', () => {
    expect(spans('{sot}\ne|--3--|\n{eot}')).toEqual([
      ['{sot}', 'tok-heading'],
      ['e|--3--|', 'tok-monospace'],
      ['{eot}', 'tok-heading'],
    ]);
  });

  it('reports no chord problems inside a tab block', () => {
    expect(chordProblems('{title: x}\n{start_of_tab}\nB|--[0]--[Xq7--|\n{end_of_tab}\n[Xq7]la')).toEqual([
      expect.objectContaining({ code: 'unknown', name: 'Xq7' }),
    ]);
  });

  it('still flags a tab block that is never closed', () => {
    expect(chordProblems('{title: x}\n{start_of_tab}\ne|--0--|').map((p) => p.code)).toEqual(['unmatchedStart']);
  });

  it('offers no chords inside a tab block, but does after it', () => {
    const complete = (doc: string) => {
      const state = EditorState.create({ doc: doc.replace('|', '') });
      return chordCompletionSource(new CompletionContext(state, doc.indexOf('|'), false));
    };
    expect(complete('{key: G}\n{start_of_tab}\ne--[|\n{end_of_tab}')).toBeNull();
    expect(complete('{key: G}\n{start_of_tab}\ne--0--\n{end_of_tab}\n[|')).not.toBeNull();
  });

  it('knows which lines are tab text', () => {
    expect(insideTab(['a', '{sot}', 'b', '{eot}', 'c', '{start_of_tab: X}', 'd'])).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
      true,
    ]);
  });
});

it('leaves a single blank line around an imported tab', () => {
  const ug = ['[Intro]', ...STRINGS, '', '[Verse 1]', 'G          C', 'Some words here'].join('\n');
  expect(toChordPro(ug)).not.toMatch(/\n{3,}/);
});
