import * as ChordSheetJS from 'chordsheetjs';
import { PdfFormatter } from 'chordsheetjs/pdf';
import { PDFDocument } from 'pdf-lib';
import type { jsPDF } from 'jspdf';
import { sliceTab } from './tabLayout';
import { prepareSong, resolveEffectivePreferences } from './chords';
import { entryContent, entrySemitones } from './setlistKeys';
import { buildPdfConfig } from './pdf-config';
import { EMBEDDED_FONT } from './constants';
import { downloadBlob } from './download';
import { loadPdfFont, makePdfConstructor, unsupportedChars, type PdfFontData } from './pdf-fonts';
import type { Setlist } from '../types/setlist';

// The library breaks pages mid-verse, so keep a song on one page where we can.
// Floor matches the app's own font scale.
const FIT_FLOOR = -3;

const downloadPdf = (bytes: Uint8Array, filename: string) => downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), filename);

async function loadFontFor(content: string): Promise<PdfFontData | null> {
  try {
    return await loadPdfFont(content);
  } catch {
    throw new Error('Could not load the font needed for this song');
  }
}

// Courier is one of the PDF standard fonts: it draws plain ASCII and nothing else.
const COURIER_SAFE = /^[\x20-\x7e]*$/;

/** Verbatim text of a tab line (Literal items), else null. */
function literalText(line: ChordSheetJS.Line): string | null {
  if (!line.items.some((it) => it instanceof ChordSheetJS.Literal)) return null;
  return line.items.map((it) => (it instanceof ChordSheetJS.Literal ? it.string : '')).join('');
}

const commentLine = (type: string, text: string) =>
  new ChordSheetJS.Line({ type, items: [new ChordSheetJS.Tag('comment', text)] });

/**
 * Packs tab slices into rows that fit the column, like the song view wraps them.
 * A row always takes at least one slice, even one that is too wide on its own.
 */
function packRows(slices: string[][], fits: (text: string) => boolean): string[][][] {
  const rows: string[][][] = [];
  let row: string[][] = [];
  const lineOf = (r: string[][], i: number) => r.map((s) => s[i]).join('').replace(/\s+$/, '');
  for (const slice of slices) {
    const candidate = [...row, slice];
    if (row.length && !slice.every((_, i) => fits(lineOf(candidate, i)))) {
      rows.push(row);
      row = [slice];
    } else {
      row = candidate;
    }
  }
  if (row.length) rows.push(row);
  return rows;
}

/**
 * The PDF formatter draws nothing for tab lines (Literal items), so they go in as
 * comment lines, which it does draw. A tab wider than the column would wrap each
 * string on its own there, so every tab block is cut into slices like in the song
 * view and the slices are packed into rows that fit (`fits`), separated by a blank line.
 *
 * Comments share one font, so they are set in Courier to keep the strings lined up,
 * but only when every comment is plain ASCII: Courier cannot draw anything else, and
 * the song's own font is the safer choice then.
 */
export function tabsForPdf(
  song: ChordSheetJS.Song,
  fits: (text: string) => boolean = () => true,
): { song: ChordSheetJS.Song; monoComments: boolean } {
  const tabTexts = song.lines.map(literalText).filter((t): t is string => t !== null);
  if (!tabTexts.length) return { song, monoComments: false };

  const comments = song.lines
    .flatMap((l) => l.items)
    .filter((it): it is ChordSheetJS.Tag => it instanceof ChordSheetJS.Tag && it.isComment())
    .map((tag) => tag.value ?? '');
  const monoComments = [...comments, ...tabTexts].every((text) => COURIER_SAFE.test(text));

  const lines: ChordSheetJS.Line[] = [];
  let run: ChordSheetJS.Line[] = [];
  const flush = () => {
    if (!run.length) return;
    const type = run[0].type;
    const texts = run.map((l) => (literalText(l) ?? '').replace(/\s+$/, ''));
    packRows(sliceTab(texts), fits).forEach((row, r) => {
      if (r) lines.push(commentLine(type, ''));
      texts.forEach((_, i) => lines.push(commentLine(type, row.map((s) => s[i]).join('').replace(/\s+$/, ''))));
    });
    run = [];
  };
  for (const line of song.lines) {
    const text = literalText(line);
    if (text === null) {
      flush();
      lines.push(line);
    } else if (text.trim()) {
      run.push(line);
    } else {
      flush();
      lines.push(commentLine(line.type, ''));
    }
  }
  flush();

  const out = song.clone();
  out.lines = lines;
  return { song: out, monoComments };
}

type PdfConfiguration = PdfFormatter['configuration'];

/** Whether a comment line fits one column of the page, measured in the comment font. */
function commentFits(doc: jsPDF, cfg: PdfConfiguration): (text: string) => boolean {
  const { margins } = cfg.layout.global;
  const columnCount = cfg.layout.sections.global.columnCount ?? 1;
  const columnSpacing = cfg.layout.sections.global.columnSpacing ?? 0;
  const page = doc.internal.pageSize.getWidth() - margins.left - margins.right;
  const column = (page - (columnCount - 1) * columnSpacing) / columnCount;
  const font = cfg.fonts.comment;
  return (text) => {
    doc.setFont(font.name, font.style);
    doc.setFontSize(font.size);
    return doc.getTextWidth(text) <= column;
  };
}

async function renderOne(
  content: string,
  transpose: number,
  nashville: boolean,
  fontSize: number,
): Promise<Uint8Array> {
  const prepared = prepareSong(content, transpose, nashville);
  if (!prepared) throw new Error('Could not parse this song');
  const { monoComments } = tabsForPdf(prepared);

  const fontBase64 = await loadFontFor(content);
  const Doc = makePdfConstructor(fontBase64);
  const fontName = fontBase64 ? EMBEDDED_FONT : null;

  // chordsheetjs and chordsheetjs/pdf each declare their own Song class, so the
  // types don't match across entry points even though it's one object at runtime.
  const forPdf = (song: ChordSheetJS.Song) => song as unknown as Parameters<PdfFormatter['format']>[0];
  const metadata = (name: string) => {
    const value = prepared.getMetadataValue(name);
    return Array.isArray(value) ? value.join(',') : value || '';
  };
  const key = metadata('key');
  const headerText = [metadata('title'), key ? `Key of ${key}` : '', metadata('artist')];
  const measurement = new PdfFormatter(buildPdfConfig({ fontName, fontSize, monoComments }));
  measurement.format(forPdf(tabsForPdf(prepared).song), Doc);
  const measureDoc = measurement.getDocumentWrapper().doc;

  let requested: Uint8Array | null = null;
  for (let size = fontSize; ; size--) {
    const formatter = new PdfFormatter(buildPdfConfig({ fontName, fontSize: size, headerText, doc: measureDoc, monoComments }));
    // Tabs wrap to the column at this size, so the layout is redone for every size tried.
    const { song } = tabsForPdf(prepared, commentFits(measureDoc, formatter.configuration));
    formatter.format(forPdf(song), Doc);
    const wrapper = formatter.getDocumentWrapper();
    const bytes = new Uint8Array(wrapper.doc.output('arraybuffer'));
    requested ??= bytes;
    if (wrapper.totalPages === 1) return bytes;
    // Shrinking did not rescue it — don't punish the reader with tiny text.
    if (size <= FIT_FLOOR) return requested;
  }
}

interface SongData {
  title: string;
  artist: string;
  content: string;
  bpm: number | null;
}

interface SongExportOptions {
  transpose: number;
  nashville: boolean;
  fontSize: number;
}

/** Resolves to the characters no available font can draw (empty when all is well). */
export async function exportSongPdf(song: SongData, options: SongExportOptions): Promise<string[]> {
  const bytes = await renderOne(song.content, options.transpose, options.nashville, options.fontSize);
  const name = [song.title, song.artist].filter(Boolean).join(' - ') || 'song';
  downloadPdf(bytes, `${name}.pdf`);
  return unsupportedChars(song.content);
}

export async function exportSetlistPdf(
  setlist: Setlist,
  globalSettings: { nashville: boolean; fontSize: number },
): Promise<string[]> {
  const entries = setlist.entries.filter((e) => !e.is_private_placeholder);
  if (!entries.length) throw new Error('No exportable songs in this setlist');

  const missing = new Set<string>();
  const parts: Uint8Array[] = [];

  for (const entry of entries) {
    const prefs = resolveEffectivePreferences(entry, {
      nashville: !!globalSettings.nashville,
      twoCol: false,
      fontSize: globalSettings.fontSize,
      hideYt: false,
    });
    const content = entryContent(entry);
    const semitones = entrySemitones(content, entry.target_key);
    parts.push(await renderOne(content, semitones, prefs.nashville, prefs.fontSize));
    unsupportedChars(content).forEach((c) => missing.add(c));
  }

  const merged = await PDFDocument.create();
  for (const part of parts) {
    const src = await PDFDocument.load(part);
    (await merged.copyPages(src, src.getPageIndices())).forEach((p) => merged.addPage(p));
  }

  downloadPdf(await merged.save(), `${setlist.name || 'setlist'}.pdf`);
  return [...missing];
}
