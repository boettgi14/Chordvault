import { toChordPro, updateDirective } from '../chords';

// A labelled section or a comment right below the header used to be taken for header
// metadata, and every later line with the same directive name was then dropped as a
// "duplicate" on save, leaving orphaned {end_of_…} lines behind.
describe('toChordPro keeps labelled sections and comments', () => {
  it('keeps every labelled section after one right below the header', () => {
    const content = [
      '{title: X}',
      '{key: G}',
      '{start_of_verse: Strophe 1}',
      '[G]eins',
      '{end_of_verse}',
      '',
      '{start_of_verse: Strophe 2}',
      '[C]zwei',
      '{end_of_verse}',
      '',
      '{start_of_chorus: Refrain}',
      '[D]drei',
      '{end_of_chorus}',
    ].join('\n');
    const out = toChordPro(content);
    expect(out).toContain('{start_of_verse: Strophe 1}');
    expect(out).toContain('{start_of_verse: Strophe 2}');
    expect(out).toContain('{start_of_chorus: Refrain}');
    expect(out.match(/\{start_of_verse/g)).toHaveLength(2);
    expect(out.match(/\{end_of_verse\}/g)).toHaveLength(2);
  });

  it('keeps them with a blank line after the header too', () => {
    const content =
      '{title: X}\n\n{start_of_verse: A}\n[G]eins\n{end_of_verse}\n\n{start_of_verse: B}\n[C]zwei\n{end_of_verse}';
    const out = toChordPro(content);
    expect(out).toContain('{start_of_verse: A}');
    expect(out).toContain('{start_of_verse: B}');
  });

  it('keeps every comment after one right below the header', () => {
    const out = toChordPro('{title: X}\n{comment: Capo 2}\n[G]eins\n\n{comment: Langsam}\n[C]zwei');
    expect(out).toContain('{comment: Capo 2}');
    expect(out).toContain('{comment: Langsam}');
  });

  it('keeps the short section forms', () => {
    const out = toChordPro('{title: X}\n{soc: Refrain}\n[G]eins\n{eoc}\n\n{soc: Refrain 2}\n[C]zwei\n{eoc}');
    expect(out).toMatch(/Refrain\b/);
    expect(out).toMatch(/Refrain 2/);
  });

  it('still keeps header metadata once', () => {
    const out = toChordPro('{title: X}\n{key: G}\n{x_tags: worship}\n[G]eins');
    expect(out.match(/\{title: X\}/g)).toHaveLength(1);
    expect(out.match(/\{key: G\}/g)).toHaveLength(1);
    expect(out).toContain('{x_tags: worship}');
  });
});

describe('updateDirective with a labelled section below the header', () => {
  it('inserts new metadata above the section, not inside it', () => {
    const content = '{title: X}\n{start_of_verse: Strophe 1}\n[G]eins\n{end_of_verse}';
    expect(updateDirective(content, 'key', 'G')).toBe(
      '{title: X}\n{key: G}\n{start_of_verse: Strophe 1}\n[G]eins\n{end_of_verse}',
    );
  });

  it('inserts above a comment as well', () => {
    const content = '{title: X}\n{comment: Capo 2}\n[G]eins';
    expect(updateDirective(content, 'x_tags', 'hymn')).toBe('{title: X}\n{x_tags: hymn}\n{comment: Capo 2}\n[G]eins');
  });
});
