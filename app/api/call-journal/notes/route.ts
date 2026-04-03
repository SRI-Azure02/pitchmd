import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const date = request.nextUrl.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Missing or invalid date (expected YYYY-MM-DD)' }, { status: 400 });
  }

  try {
    const sf = getSnowflakeClient();
    const notes = await sf.getCallNotes(session.userId, date);
    return NextResponse.json({ notes });
  } catch (err: any) {
    console.error('[call-journal/notes] GET error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { physicianId, callDate, callTimestamp, transcript, aiSummary } =
    await request.json() as {
      physicianId: string;
      callDate: string;
      callTimestamp: string;
      transcript: string;
      aiSummary: string;
    };

  if (!physicianId || !callDate || !transcript) {
    return NextResponse.json({ error: 'physicianId, callDate, and transcript are required' }, { status: 400 });
  }

  try {
    const sf = getSnowflakeClient();
    const noteId = randomUUID();
    await sf.saveCallNote(session.userId, physicianId, callDate, callTimestamp, transcript, aiSummary ?? '', noteId);
    return NextResponse.json({ ok: true, noteId });
  } catch (err: any) {
    console.error('[call-journal/notes] POST error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { noteId, transcript, aiSummary } =
    await request.json() as { noteId: string; transcript: string; aiSummary: string };

  if (!noteId || !transcript) {
    return NextResponse.json({ error: 'noteId and transcript are required' }, { status: 400 });
  }

  try {
    const sf = getSnowflakeClient();
    await sf.updateCallNote(noteId, transcript, aiSummary ?? '');
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[call-journal/notes] PUT error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
