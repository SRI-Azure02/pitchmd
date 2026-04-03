import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sf = getSnowflakeClient();
    const tasks = await sf.getLoopbackTasks(session.userId);
    return NextResponse.json({ tasks });
  } catch (err: any) {
    console.error('[loopback/tasks] GET error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { physicianId, taskText } = await request.json() as { physicianId: string; taskText: string };
  if (!physicianId || !taskText?.trim()) {
    return NextResponse.json({ error: 'physicianId and taskText are required' }, { status: 400 });
  }

  try {
    const sf = getSnowflakeClient();
    const taskId = randomUUID();
    await sf.insertLoopbackTask(taskId, session.userId, physicianId, null, taskText.trim());
    return NextResponse.json({ ok: true, taskId });
  } catch (err: any) {
    console.error('[loopback/tasks] POST error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json() as { taskId: string; completed?: boolean; deleted?: boolean };
  const { taskId } = body;
  if (!taskId) return NextResponse.json({ error: 'taskId is required' }, { status: 400 });

  try {
    const sf = getSnowflakeClient();
    if (body.deleted === true) {
      await sf.deleteLoopbackTask(taskId);
    } else if (body.completed !== undefined) {
      await sf.setLoopbackTaskCompleted(taskId, body.completed);
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[loopback/tasks] PATCH error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
