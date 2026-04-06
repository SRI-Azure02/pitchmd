/**
 * Shared zod schemas and validation helpers for API route input validation.
 *
 * All AI-touching and Snowflake-touching routes should validate their inputs
 * here before reaching business logic.
 */
import { z } from 'zod';
import { NextResponse } from 'next/server';

// ── Primitive schemas ─────────────────────────────────────────────────────────

/** All Snowflake entity IDs are UUID v4. */
export const UuidSchema = z.string().uuid('Invalid ID format');

/** Transcripts are capped to prevent runaway AI token costs. */
const MAX_TRANSCRIPT_CHARS = 100_000;
export const TranscriptSchema = z
  .string()
  .min(1, 'transcript is required')
  .max(MAX_TRANSCRIPT_CHARS, `transcript must be under ${MAX_TRANSCRIPT_CHARS} characters`);

// ── Per-endpoint input schemas ─────────────────────────────────────────────

export const PlaybookInputSchema = z.object({
  physicianId: UuidSchema,
});

export const EvalSubmitInputSchema = z.object({
  physicianId: UuidSchema,
  transcript: TranscriptSchema,
});

export const SummarizeInputSchema = z.object({
  transcript: TranscriptSchema,
});

export const ExtractInputSchema = z.object({
  noteId: UuidSchema,
  physicianId: UuidSchema,
  transcript: TranscriptSchema,
});

export const CreateTaskInputSchema = z.object({
  physicianId: UuidSchema,
  taskText: z.string().min(1, 'taskText is required').max(500, 'taskText must be under 500 characters'),
});

export const UpdateTaskInputSchema = z.object({
  taskId: UuidSchema,
  completed: z.boolean().optional(),
  deleted: z.boolean().optional(),
});

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Parse and validate `body` against `schema`.
 * Returns `{ data }` on success or `{ errorResponse }` on failure.
 */
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  body: unknown,
): { data: T; errorResponse?: never } | { data?: never; errorResponse: NextResponse } {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = (result.error.issues ?? (result.error as any).errors ?? []).map((e: any) => e.message).join('; ');
    return {
      errorResponse: NextResponse.json({ error: message }, { status: 400 }),
    };
  }
  return { data: result.data };
}
