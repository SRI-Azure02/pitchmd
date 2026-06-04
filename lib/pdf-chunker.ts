/**
 * pdf-chunker.ts
 *
 * Extracts text from a PDF buffer and splits it into overlapping chunks
 * suitable for vector embedding and RAG retrieval.
 *
 * Strategy: sliding word-window (not paragraph-based).
 * PDFs extracted via unpdf often lack paragraph separators, so we split
 * purely by word count with a fixed overlap window.
 */

// unpdf is designed for Node.js serverless (no DOM dependency)
async function parsePdf(buffer: Buffer): Promise<string> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const uint8 = new Uint8Array(buffer);
  const doc   = await getDocumentProxy(uint8);
  const { text } = await extractText(doc, { mergePages: true });
  return text ?? '';
}

export interface DocumentChunk {
  chunkText:    string;
  chunkIndex:   number;
  pageNumber:   number | null;
  sectionLabel: string | null;
}

const TARGET_WORDS   = 400;   // words per chunk
const OVERLAP_WORDS  = 60;    // words carried over between chunks
const WORDS_PER_PAGE = 350;   // rough estimate for page number calculation
const MIN_CHUNK_WORDS = 30;   // discard tail chunks smaller than this

/** Detect a section label from the first 200 chars of a chunk. */
function detectSection(text: string): string | null {
  const head = text.slice(0, 300);
  // Numbered section headers: "1 INDICATIONS AND USAGE", "5.3 Cytopenias"
  const numbered = head.match(/^\s*(\d+(?:\.\d+)?)\s+([A-Z][A-Z\s,()/-]{4,60})/m);
  if (numbered) return numbered[0].trim().slice(0, 200);
  // ALL-CAPS headings
  const allCaps = head.match(/^[A-Z][A-Z\s]{8,60}[A-Z](\s*[-–]\s*[A-Z][A-Z\s]{4,40})?/m);
  if (allCaps) return allCaps[0].trim().slice(0, 200);
  return null;
}

/**
 * Split plain text into overlapping fixed-size word windows.
 * This approach is robust to PDFs that lack paragraph separators.
 */
function chunkBySlidingWindow(text: string): DocumentChunk[] {
  // Normalise whitespace (collapse runs of spaces/newlines to single space)
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return [];

  const chunks: DocumentChunk[] = [];
  const step   = TARGET_WORDS - OVERLAP_WORDS; // advance per chunk
  let   start  = 0;

  while (start < words.length) {
    const end        = Math.min(start + TARGET_WORDS, words.length);
    const chunkWords = words.slice(start, end);

    if (chunkWords.length >= MIN_CHUNK_WORDS) {
      const chunkText = chunkWords.join(' ');
      chunks.push({
        chunkText,
        chunkIndex:   chunks.length,
        pageNumber:   Math.floor(start / WORDS_PER_PAGE) + 1,
        sectionLabel: detectSection(chunkText),
      });
    }

    if (end >= words.length) break;
    start += step;
  }

  return chunks;
}

/**
 * Parse a PDF buffer and return text chunks ready for embedding.
 */
export async function pdfToChunks(buffer: Buffer): Promise<DocumentChunk[]> {
  const text = await parsePdf(buffer);
  if (!text || text.trim().length < 100) {
    throw new Error(
      'PDF text extraction returned no usable content. ' +
      'The file may be image-based or password-protected.',
    );
  }
  const chunks = chunkBySlidingWindow(text);
  console.log(
    `[pdf-chunker] ${chunks.length} chunks from ${text.length} chars / ` +
    `~${Math.round(text.split(/\s+/).length)} words`,
  );
  return chunks;
}
