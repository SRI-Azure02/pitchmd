import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';
import Anthropic from '@anthropic-ai/sdk';

function normalizeText(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { noteId, physicianId, transcript } =
    await request.json() as { noteId: string; physicianId: string; transcript: string };

  if (!noteId || !physicianId || !transcript?.trim()) {
    return NextResponse.json({ error: 'noteId, physicianId, and transcript are required' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 });

  try {
    // 1. Extract action items from transcript
    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Extract all concrete follow-up action items and commitments from this pharmaceutical sales call note. Return ONLY a JSON array of short, specific task strings (max 120 chars each). If there are no clear action items, return an empty array [].

Call note:
${transcript}

Return format: ["task 1", "task 2", ...]`,
      }],
    });

    let extracted: string[] = [];
    const raw = (msg.content[0] as any)?.text?.trim() ?? '[]';
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      extracted = match ? JSON.parse(match[0]) : [];
      extracted = extracted.filter((t: any) => typeof t === 'string' && t.trim());
    } catch {
      console.warn('[loopback/extract] Failed to parse AI response:', raw);
    }

    if (extracted.length === 0) {
      return NextResponse.json({ inserted: 0, tasks: [] });
    }

    // 2. Load existing tasks for this note (all statuses) to deduplicate
    const sf = getSnowflakeClient();
    const existing = await sf.getLoopbackTasksBySourceNote(session.userId, noteId);
    const existingNorms = new Set(existing.map((t: any) => normalizeText(t.TASK_TEXT)));

    // 3. Insert only new unique tasks
    const toInsert = extracted.filter(t => !existingNorms.has(normalizeText(t)));
    const inserted: any[] = [];

    for (const taskText of toInsert) {
      const taskId = randomUUID();
      await sf.insertLoopbackTask(taskId, session.userId, physicianId, noteId, taskText.trim());
      inserted.push({ taskId, taskText: taskText.trim() });
    }

    return NextResponse.json({ inserted: inserted.length, tasks: inserted });
  } catch (err: any) {
    console.error('[loopback/extract] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
