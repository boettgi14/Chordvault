import * as ChordSheetJS from 'chordsheetjs';
import { PdfFormatter } from 'chordsheetjs/pdf';
import { PDFDocument } from 'pdf-lib';
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

/**
 * The PDF formatter draws nothing for tab lines (Literal items), so they go in as
 * comment lines, which it does draw. Comments share one font, so they are set in
 * Courier to keep the strings lined up, but only when every comment is plain ASCII:
 * Courier cannot draw anything else, and the song's own font is the safer choice then.
 */
export function tabsForPdf(song: ChordSheetJS.Song): { song: ChordSheetJS.Song; monoComments: boolean } {
  let hasTabs = false;
  const out = song.mapItems((item) => {
    if (!(item instanceof ChordSheetJS.Literal)) return item;
    hasTabs = true;
    return new ChordSheetJS.Tag('comment', item.string);
  });
  if (!hasTabs) return { song, monoComments: false };
  const comments = out.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.items))
    .filter((it): it is ChordSheetJS.Tag => it instanceof ChordSheetJS.Tag && it.isComment())
    .map((tag) => tag.value ?? '');
  return { song: out, monoComments: comments.every((text) => COURIER_SAFE.test(text)) };
}

async function renderOne(
  content: string,
  transpose: number,
  nashville: boolean,
  fontSize: number,
): Promise<Uint8Array> {
  const prepared = prepareSong(content, transpose, nashville);
  if (!prepared) throw new Error('Could not parse this song');
  const { song, monoComments } = tabsForPdf(prepared);

  const fontBase64 = await loadFontFor(content);
  const Doc = makePdfConstructor(fontBase64);
  const fontName = fontBase64 ? EMBEDDED_FONT : null;

  // chordsheetjs and chordsheetjs/pdf each declare their own Song class, so the
  // types don't match across entry points even though it's one object at runtime.
  const forPdf = song as unknown as Parameters<PdfFormatter['format']>[0];
  const metadata = (name: string) => {
    const value = song.getMetadataValue(name);
    return Array.isArray(value) ? value.join(',') : value || '';
  };
  const key = metadata('key');
  const headerText = [metadata('title'), key ? `Key of ${key}` : '', metadata('artist')];
  const measurement = new PdfFormatter(buildPdfConfig({ fontName, fontSize, monoComments }));
  measurement.format(forPdf, Doc);
  const measureDoc = measurement.getDocumentWrapper().doc;

  let requested: Uint8Array | null = null;
  for (let size = fontSize; ; size--) {
    const formatter = new PdfFormatter(buildPdfConfig({ fontName, fontSize: size, headerText, doc: measureDoc, monoComments }));
    formatter.format(forPdf, Doc);
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
