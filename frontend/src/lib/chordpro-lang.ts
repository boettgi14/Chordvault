import { StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { CHORD_TOKEN, SECTION_DIRECTIVE, TAB_END, TAB_START } from './chordTokens';

interface ChordProState {
  /** Between {start_of_tab} and {end_of_tab}: lines are tab text, not chords and lyrics. */
  inTab: boolean;
}

const chordProParser = StreamLanguage.define<ChordProState>({
  languageData: { closeBrackets: { brackets: ['[', '{'] } },
  startState: () => ({ inTab: false }),
  copyState: (state) => ({ ...state }),
  token(stream, state) {
    if (stream.sol()) {
      const line = stream.string;
      if (state.inTab && TAB_END.test(line)) state.inTab = false;
      else if (!state.inTab && TAB_START.test(line)) state.inTab = true;
      // A tab line is one token, so a bracket in it is not coloured as a chord.
      else if (state.inTab) {
        stream.skipToEnd();
        return 'monospace';
      }
    }
    // Chord in brackets: [Am7], [G/B]
    if (stream.match(CHORD_TOKEN)) return 'keyword';
    // Section directives: {verse}, {chorus}, {bridge}, {start_of_chorus}, {sot}, etc.
    if (stream.match(SECTION_DIRECTIVE) || stream.match(/\{(?:sot|eot)\b[^}]*\}/i)) return 'heading';
    // Metadata directives: {title:}, {artist:}, {key:}, {tempo:}, {capo:}, etc.
    if (stream.match(/\{[^}]*\}/)) return 'meta';
    // Comment lines starting with #
    if (stream.sol() && stream.match(/#.*/)) return 'comment';
    // Skip to next token
    stream.next();
    return null;
  },
});

// --chord (#e6a530) = amber for chords (matches existing chord rendering)
// --accent-alt (#7a9bb5) = steel blue for section directives
// Tab text sits on the same quiet band as a chorus does in the song view.
const chordProHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--chord)' },
  { tag: tags.heading, color: 'var(--accent-alt)', fontWeight: 'bold' },
  { tag: tags.meta, color: 'var(--muted)' },
  { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: tags.monospace, color: 'var(--text)', backgroundColor: 'color-mix(in srgb, var(--band) 60%, transparent)' },
]);

export const chordProLanguage = chordProParser;
export const chordProHighlightStyle = syntaxHighlighting(chordProHighlight);
