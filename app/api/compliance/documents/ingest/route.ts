import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';
import { pdfToChunks } from '@/lib/pdf-chunker';

function isAdmin(email?: string, username?: string, userId?: string): boolean {
  const adminList = (process.env.COMPLIANCE_ADMIN_EMAILS ?? '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return adminList.includes(email?.toLowerCase() ?? '__none__')
      || adminList.includes(username?.toLowerCase() ?? '__none__')
      || adminList.includes(userId?.toLowerCase() ?? '__none__');
}

/**
 * POST /api/compliance/documents/ingest
 *
 * Accepts a multipart/form-data upload with:
 *   file     — the PDF file
 *   product  — product name (e.g. "Venclexta")
 *   doc_type — "pi" | "detail_aid" | "clinical_summary" | "claims_library"
 *
 * Pipeline: PDF → text extraction → chunking → Snowflake Cortex embedding → storage
 *
 * Returns: { docId, docName, chunkCount }
 */
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(session.email, session.username, session.userId))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const formData = await request.formData();
    const file    = formData.get('file')    as File | null;
    const product = (formData.get('product')  as string | null) ?? '';
    const docType = (formData.get('doc_type') as string | null) ?? 'pi';

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!file.name.toLowerCase().endsWith('.pdf'))
      return NextResponse.json({ error: 'Only PDF files are supported' }, { status: 400 });

    const docName = file.name.replace(/\.pdf$/i, '').replace(/_/g, ' ');
    console.log(`[rag:ingest] Starting: ${docName} (${(file.size / 1024).toFixed(0)} KB)`);

    // 1. Extract PDF → chunks
    const buffer = Buffer.from(await file.arrayBuffer());
    const chunks = await pdfToChunks(buffer);
    console.log(`[rag:ingest] ${chunks.length} chunks extracted from ${docName}`);

    // 2. Register document in SYNTHETIC_COMPLIANCE_DOCUMENTS
    const sf = getSnowflakeClient();
    const docId = await sf.registerDocument({
      docName,
      docType,
      product: product || null,
      approvedBy: session.email ?? session.username,
    });

    if (!docId) throw new Error('Failed to register document — no DOC_ID returned');
    console.log(`[rag:ingest] Document registered: ${docId}`);

    // 3. Ingest each chunk with Snowflake Cortex embedding
    // Sequential to avoid overwhelming the Snowflake endpoint
    let ingested = 0;
    for (const chunk of chunks) {
      try {
        await sf.ingestDocumentChunk({
          docId,
          chunkText:    chunk.chunkText,
          chunkIndex:   chunk.chunkIndex,
          pageNumber:   chunk.pageNumber,
          sectionLabel: chunk.sectionLabel,
        });
        ingested++;
        if (ingested % 10 === 0) {
          console.log(`[rag:ingest] ${ingested}/${chunks.length} chunks embedded`);
        }
      } catch (chunkErr: any) {
        console.error(`[rag:ingest] chunk ${chunk.chunkIndex} failed:`, chunkErr?.message);
        // Continue with remaining chunks — partial ingestion is better than none
      }
    }

    console.log(`[rag:ingest] Complete: ${ingested}/${chunks.length} chunks ingested for ${docName}`);
    return NextResponse.json({ docId, docName, chunkCount: ingested, totalChunks: chunks.length });

  } catch (err: any) {
    console.error('[rag:ingest] error:', err?.message);
    return NextResponse.json({ error: err?.message ?? 'Ingestion failed' }, { status: 500 });
  }
}

// Increase body size limit for PDF uploads (default 4MB in Next.js)
export const config = {
  api: { bodyParser: false },
};
