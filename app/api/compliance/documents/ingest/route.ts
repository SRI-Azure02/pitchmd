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

// Cortex embedding models to try in order (all 768-dim — matches VECTOR(FLOAT, 768))
const EMBEDDING_MODELS = [
  'e5-base-v2',
  'snowflake-arctic-embed-m',
  'multilingual-e5-small',
];

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

    if (chunks.length === 0) {
      return NextResponse.json({
        error: 'No text could be extracted from this PDF. The file may be image-based or encrypted.',
      }, { status: 400 });
    }

    // 2. Register document
    const sf = getSnowflakeClient();
    const docId = await sf.registerDocument({
      docName, docType,
      product: product || null,
      approvedBy: session.email ?? session.username,
    });
    if (!docId) throw new Error('Failed to register document — no DOC_ID returned');

    // 3. Probe Cortex: try each model on the first chunk to find one that works
    let workingModel: string | null = null;
    let cortexError = '';
    for (const model of EMBEDDING_MODELS) {
      try {
        await sf.ingestDocumentChunk({
          docId, model,
          chunkText:    chunks[0].chunkText,
          chunkIndex:   0,
          pageNumber:   chunks[0].pageNumber,
          sectionLabel: chunks[0].sectionLabel,
        });
        workingModel = model;
        console.log(`[rag:ingest] Cortex model confirmed: ${model}`);
        break;
      } catch (probeErr: any) {
        cortexError = probeErr?.message ?? String(probeErr);
        console.warn(`[rag:ingest] model ${model} failed: ${cortexError}`);
      }
    }

    // 4a. If Cortex works, embed remaining chunks with the confirmed model
    let ingested = 0;
    let mode: 'vector' | 'keyword' = 'keyword';

    if (workingModel) {
      mode = 'vector';
      ingested = 1; // chunk 0 already done
      for (const chunk of chunks.slice(1)) {
        try {
          await sf.ingestDocumentChunk({
            docId, model: workingModel,
            chunkText:    chunk.chunkText,
            chunkIndex:   chunk.chunkIndex,
            pageNumber:   chunk.pageNumber,
            sectionLabel: chunk.sectionLabel,
          });
          ingested++;
          if (ingested % 20 === 0)
            console.log(`[rag:ingest] ${ingested}/${chunks.length} chunks embedded`);
        } catch (chunkErr: any) {
          console.error(`[rag:ingest] chunk ${chunk.chunkIndex} failed:`, chunkErr?.message);
        }
      }
    } else {
      // 4b. Cortex unavailable — store chunks without embeddings (keyword-only mode)
      console.warn(`[rag:ingest] Cortex unavailable — falling back to keyword mode. Last error: ${cortexError}`);
      for (const chunk of chunks) {
        try {
          await sf.ingestDocumentChunkNoEmbedding({
            docId,
            chunkText:    chunk.chunkText,
            chunkIndex:   chunk.chunkIndex,
            pageNumber:   chunk.pageNumber,
            sectionLabel: chunk.sectionLabel,
          });
          ingested++;
        } catch (chunkErr: any) {
          console.error(`[rag:ingest] keyword chunk ${chunk.chunkIndex} failed:`, chunkErr?.message);
        }
      }
    }

    console.log(`[rag:ingest] Complete: ${ingested}/${chunks.length} chunks (${mode} mode) for ${docName}`);
    return NextResponse.json({
      docId, docName,
      chunkCount:  ingested,
      totalChunks: chunks.length,
      mode,
      warning: mode === 'keyword'
        ? `Snowflake Cortex embedding unavailable (${cortexError?.slice(0, 200)}). Chunks stored in keyword-search mode — retrieval quality will be lower.`
        : undefined,
    });

  } catch (err: any) {
    console.error('[rag:ingest] error:', err?.message);
    return NextResponse.json({ error: err?.message ?? 'Ingestion failed' }, { status: 500 });
  }
}

export const config = { api: { bodyParser: false } };
