import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';
import { validateInput, CreateTaskInputSchema, UpdateTaskInputSchema } from '@/lib/validate';

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

  const { data: taskData, errorResponse: taskError } = validateInput(CreateTaskInputSchema, await request.json());
  if (taskError) return taskError;
  const { physicianId, taskText } = taskData;

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

  const { data: body, errorResponse: bodyError } = validateInput(UpdateTaskInputSchema, await request.json());
  if (bodyError) return bodyError;
  const { taskId } = body;

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
