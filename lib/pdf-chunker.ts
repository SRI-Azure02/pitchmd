/**
 * pdf-chunker.ts
 *
 * Extracts text from a PDF buffer and splits it into overlapping chunks
 * suitable for vector embedding and RAG retrieval.
 *
 * Strategy:
 *  - Parse PDF → extract full text
 *  - Split on natural paragraph/section boundaries
 *  - Target ~500 words per chunk, 80-word overlap between consecutive chunks
 *  - Detect section labels (numbered headings) for metadata
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
  chunkText: string;
  chunkIndex: number;
  /** Rough page estimate (actual page numbers not reliably extracted) */
  pageNumber: number | null;
  /** Section heading detected above this chunk, if any */
  sectionLabel: string | null;
}

const TARGET_WORDS   = 500;
const OVERLAP_WORDS  = 80;

/** Simple section heading patterns (numbered sections, all-caps headings) */
const SECTION_RE = /^(?:\d+[\.\s]+[A-Z][^a-z]{5,}|[A-Z][A-Z\s]{8,}:?\s*$)/m;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function detectSection(paragraph: string): string | null {
  const m = paragraph.match(SECTION_RE);
  return m ? m[0].trim().slice(0, 200) : null;
}

/**
 * Splits plain text into overlapping chunks.
 * Paragraph boundaries are preferred split points.
 */
function chunkText(text: string): DocumentChunk[] {
  // Normalise whitespace and split into paragraphs
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 20); // discard very short fragments

  const chunks: DocumentChunk[] = [];
  let currentWords: string[] = [];
  let currentSection: string | null = null;
  let chunkIndex = 0;

  for (const para of paragraphs) {
    // Track section labels
    const section = detectSection(para);
    if (section) currentSection = section;

    const paraWords = para.split(/\s+/).filter(Boolean);

    // If adding this paragraph exceeds target, flush current chunk first
    if (currentWords.length > 0 && currentWords.length + paraWords.length > TARGET_WORDS) {
      chunks.push({
        chunkText:    currentWords.join(' '),
        chunkIndex:   chunkIndex++,
        pageNumber:   null, // estimated below
        sectionLabel: currentSection,
      });
      // Keep trailing overlap words for context continuity
      currentWords = currentWords.slice(-OVERLAP_WORDS);
    }

    currentWords.push(...paraWords);

    // Flush very large single paragraphs immediately
    if (currentWords.length >= TARGET_WORDS * 1.5) {
      chunks.push({
        chunkText:    currentWords.join(' '),
        chunkIndex:   chunkIndex++,
        pageNumber:   null,
        sectionLabel: currentSection,
      });
      currentWords = currentWords.slice(-OVERLAP_WORDS);
    }
  }

  // Flush remainder
  if (wordCount(currentWords.join(' ')) > 30) {
    chunks.push({
      chunkText:    currentWords.join(' '),
      chunkIndex:   chunkIndex++,
      pageNumber:   null,
      sectionLabel: currentSection,
    });
  }

  // Assign rough page estimates (assume ~400 words per page)
  const WORDS_PER_PAGE = 400;
  let wordsSoFar = 0;
  for (const chunk of chunks) {
    chunk.pageNumber = Math.floor(wordsSoFar / WORDS_PER_PAGE) + 1;
    wordsSoFar += wordCount(chunk.chunkText);
  }

  return chunks;
}

/**
 * Parse a PDF buffer and return text chunks ready for embedding.
 */
export async function pdfToChunks(buffer: Buffer): Promise<DocumentChunk[]> {
  const text = await parsePdf(buffer);
  if (!text || text.trim().length < 100) {
    throw new Error('PDF text extraction returned no usable content. The file may be image-based or encrypted.');
  }
  return chunkText(text);
}
