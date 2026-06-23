import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export interface GapPriority {
  rank: number;
  area: string;
  repSaid: string;
  idealSaid: string;
  coaching: string;
}

export interface GapAnalysisResult {
  priorities: GapPriority[];
  overallAssessment: string;
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json() as {
    messages: { role: string; content: string; internal?: boolean }[];
    physicianId?: string;
  };

  const { messages, physicianId } = body;
  if (!messages?.length) return NextResponse.json({ error: 'No messages provided' }, { status: 400 });

  // Extract only non-internal rep turns for analysis
  const repTurns = messages.filter(
    (m) => m.role === 'user' && !m.internal && m.content !== '__begin_roleplay__'
  );
  if (!repTurns.length) return NextResponse.json({ error: 'No rep turns to analyse' }, { status: 400 });

  // Build transcript for Claude
  const transcript = messages
    .filter((m) => !m.internal && m.content !== '__begin_roleplay__')
    .map((m) => `${m.role === 'user' ? 'REP' : 'PHYSICIAN'}: ${m.content}`)
    .join('\n\n');

  const prompt = `You are a pharmaceutical sales coaching expert. Analyse the following sales call transcript and identify the top coaching priorities — moments where the rep's response fell short of what an ideal pharmaceutical sales rep would say.

TRANSCRIPT:
${transcript}

Return a JSON object (no markdown, no explanation, just the JSON) with this exact shape:
{
  "priorities": [
    {
      "rank": 1,
      "area": "<coaching area, e.g. 'Objection Handling' | 'Clinical Knowledge' | 'Closing' | 'Compliance' | 'Rapport'>",
      "repSaid": "<brief verbatim or paraphrase of what the rep actually said>",
      "idealSaid": "<what an ideal rep would have said instead — be specific and actionable, include example phrasing>",
      "coaching": "<1–2 sentence coaching insight explaining why the ideal approach is better>"
    }
  ],
  "overallAssessment": "<2–3 sentence summary of the rep's overall performance and the single most important thing to improve>"
}

Rules:
- Return 3–5 priorities, ranked from most impactful to least.
- Be specific: quote or closely paraphrase the rep's actual words.
- Make idealSaid concrete — give the rep actual alternative language they can use.
- Focus on substance, not style. Only flag style if it materially affects effectiveness.
- If the transcript is very short (fewer than 3 rep turns), return fewer priorities.`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');
    const result: GapAnalysisResult = JSON.parse(jsonMatch[0]);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[gap-analysis]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
