/**
 * rag-retrieval.ts
 *
 * Phase 4: RAG (Retrieval-Augmented Generation) context builder.
 *
 * At inference time, retrieves the most semantically relevant document
 * chunks from SYNTHETIC_DOCUMENT_CHUNKS using Snowflake Cortex vector
 * similarity search, then formats them as an "APPROVED DOCUMENT CONTEXT"
 * block to inject into the physician persona's system prompt.
 *
 * Mode: STRICT — the AI may only assert claims present in retrieved chunks.
 */

import type { SnowflakeClient } from '@/lib/snowflake';

export interface RetrievedChunk {
  chunkText: string;
  sectionLabel: string | null;
  pageNumber: number | null;
  product: string | null;
  docName: string;
  similarity: number;
}

/**
 * Retrieve the top-k most relevant document chunks for a given query.
 * Returns an empty array if retrieval fails (fail-open for session continuity).
 */
export async function retrieveRelevantChunks(
  queryText: string,
  sf: SnowflakeClient,
  limit = 5,
): Promise<RetrievedChunk[]> {
  try {
    return await sf.searchSimilarChunks(queryText, limit);
  } catch (err: any) {
    console.error('[rag] retrieval failed (fail open):', err?.message);
    return [];
  }
}

/**
 * Build the APPROVED DOCUMENT CONTEXT block to inject into the system prompt.
 *
 * Strict RAG mode: explicitly instructs the AI to only use retrieved context
 * and to acknowledge gaps rather than filling them from general knowledge.
 */
export function buildRagSystemBlock(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '';

  const contextItems = chunks
    .map((c, i) => {
      const source = [
        c.product ?? 'Unknown',
        c.docName,
        c.sectionLabel ? `§ ${c.sectionLabel}` : null,
        c.pageNumber   ? `p. ${c.pageNumber}`  : null,
      ].filter(Boolean).join(' — ');

      return `[SOURCE ${i + 1}: ${source}]\n${c.chunkText.trim()}`;
    })
    .join('\n\n---\n\n');

  return `

APPROVED DOCUMENT CONTEXT (STRICT RAG MODE):
The following excerpts are from MLR-approved prescribing information documents.

CRITICAL INSTRUCTIONS:
1. You may ONLY make factual claims about drugs that are directly supported
   by the excerpts below.
2. If a physician question requires information NOT present in these excerpts,
   respond: "I'd refer you to the full Prescribing Information for that detail."
3. Do NOT draw on general training knowledge for drug-specific facts —
   only the approved context below may be cited.
4. You may still respond naturally as the physician persona; these excerpts
   inform what you as the physician could know from reviewing the PI.

${contextItems}

END OF APPROVED DOCUMENT CONTEXT`;
}
