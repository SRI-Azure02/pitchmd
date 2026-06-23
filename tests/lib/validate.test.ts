import { describe, it, expect } from 'vitest';
import {
  UuidSchema,
  PhysicianIdSchema,
  TranscriptSchema,
  PlaybookInputSchema,
  EvalSubmitInputSchema,
  SummarizeInputSchema,
  ExtractInputSchema,
  CreateTaskInputSchema,
  UpdateTaskInputSchema,
  validateInput,
} from '@/lib/validate';
import { z } from 'zod';

describe('validate', () => {
  describe('UuidSchema', () => {
    it('should accept valid UUID v4', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(UuidSchema.safeParse(uuid).success).toBe(true);
    });

    it('should reject invalid UUID format', () => {
      expect(UuidSchema.safeParse('not-a-uuid').success).toBe(false);
    });

    it('should reject empty string', () => {
      expect(UuidSchema.safeParse('').success).toBe(false);
    });

    it('should reject null', () => {
      expect(UuidSchema.safeParse(null).success).toBe(false);
    });

    it('should reject undefined', () => {
      expect(UuidSchema.safeParse(undefined).success).toBe(false);
    });

    it('should accept UUID v1 format (zod uuid accepts any uuid format)', () => {
      const uuidV1 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
      expect(UuidSchema.safeParse(uuidV1).success).toBe(true);
    });
  });

  describe('PhysicianIdSchema', () => {
    it('should accept non-empty string', () => {
      expect(PhysicianIdSchema.safeParse('PHY005').success).toBe(true);
    });

    it('should accept single character', () => {
      expect(PhysicianIdSchema.safeParse('A').success).toBe(true);
    });

    it('should accept numeric string', () => {
      expect(PhysicianIdSchema.safeParse('12345').success).toBe(true);
    });

    it('should reject empty string', () => {
      expect(PhysicianIdSchema.safeParse('').success).toBe(false);
    });

    it('should reject null', () => {
      expect(PhysicianIdSchema.safeParse(null).success).toBe(false);
    });

    it('should reject undefined', () => {
      expect(PhysicianIdSchema.safeParse(undefined).success).toBe(false);
    });

    it('should accept whitespace in ID', () => {
      expect(PhysicianIdSchema.safeParse('PHY 005').success).toBe(true);
    });

    it('should accept special characters', () => {
      expect(PhysicianIdSchema.safeParse('PHY-005-A').success).toBe(true);
    });
  });

  describe('TranscriptSchema', () => {
    it('should accept valid transcript', () => {
      const transcript = 'Rep: How do I use this? AI: You can use it like this.';
      expect(TranscriptSchema.safeParse(transcript).success).toBe(true);
    });

    it('should reject empty string', () => {
      expect(TranscriptSchema.safeParse('').success).toBe(false);
    });

    it('should reject null', () => {
      expect(TranscriptSchema.safeParse(null).success).toBe(false);
    });

    it('should accept maximum length transcript', () => {
      const maxTranscript = 'a'.repeat(100_000);
      expect(TranscriptSchema.safeParse(maxTranscript).success).toBe(true);
    });

    it('should reject transcript exceeding max length', () => {
      const tooLong = 'a'.repeat(100_001);
      expect(TranscriptSchema.safeParse(tooLong).success).toBe(false);
    });

    it('should accept single character', () => {
      expect(TranscriptSchema.safeParse('a').success).toBe(true);
    });

    it('should accept transcript with special characters', () => {
      const transcript = 'Rep: @#$%^&*() AI: <>?:"{}';
      expect(TranscriptSchema.safeParse(transcript).success).toBe(true);
    });

    it('should accept multiline transcript', () => {
      const transcript = 'Line 1\nLine 2\nLine 3';
      expect(TranscriptSchema.safeParse(transcript).success).toBe(true);
    });

    it('should accept whitespace-only string after trimming', () => {
      expect(TranscriptSchema.safeParse('   ').success).toBe(true);
    });

    it('should accept very long single line', () => {
      const longLine = 'a '.repeat(50_000);
      expect(TranscriptSchema.safeParse(longLine).success).toBe(true);
    });
  });

  describe('PlaybookInputSchema', () => {
    it('should accept valid playbook input', () => {
      const input = { physicianId: 'PHY001' };
      expect(PlaybookInputSchema.safeParse(input).success).toBe(true);
    });

    it('should reject missing physicianId', () => {
      const input = {};
      expect(PlaybookInputSchema.safeParse(input).success).toBe(false);
    });

    it('should reject empty physicianId', () => {
      const input = { physicianId: '' };
      expect(PlaybookInputSchema.safeParse(input).success).toBe(false);
    });

    it('should reject null physicianId', () => {
      const input = { physicianId: null };
      expect(PlaybookInputSchema.safeParse(input).success).toBe(false);
    });

    it('should accept extra properties', () => {
      const input = { physicianId: 'PHY001', extra: 'data' };
      expect(PlaybookInputSchema.safeParse(input).success).toBe(true);
    });
  });

  describe('EvalSubmitInputSchema', () => {
    it('should accept valid eval submit input', () => {
      const input = {
        physicianId: 'PHY001',
        transcript: 'Rep: Test AI: Test',
      };
      expect(EvalSubmitInputSchema.safeParse(input).success).toBe(true);
    });

    it('should reject missing physicianId', () => {
      const input = { transcript: 'Test transcript' };
      expect(EvalSubmitInputSchema.safeParse(input).success).toBe(false);
    });

    it('should reject missing transcript', () => {
      const input = { physicianId: 'PHY001' };
      expect(EvalSubmitInputSchema.safeParse(input).success).toBe(false);
    });

    it('should reject empty transcript', () => {
      const input = { physicianId: 'PHY001', transcript: '' };
      expect(EvalSubmitInputSchema.safeParse(input).success).toBe(false);
    });

    it('should accept long transcript', () => {
      const input = {
        physicianId: 'PHY001',
        transcript: 'a '.repeat(50_000),
      };
      expect(EvalSubmitInputSchema.safeParse(input).success).toBe(true);
    });
  });

  describe('SummarizeInputSchema', () => {
    it('should accept valid summarize input', () => {
      const input = { transcript: 'Rep: Test AI: Test' };
      expect(SummarizeInputSchema.safeParse(input).success).toBe(true);
    });

    it('should reject missing transcript', () => {
      const input = {};
      expect(SummarizeInputSchema.safeParse(input).success).toBe(false);
    });

    it('should reject empty transcript', () => {
      const input = { transcript: '' };
      expect(SummarizeInputSchema.safeParse(input).success).toBe(false);
    });

    it('should accept transcript near max length', () => {
      const input = { transcript: 'a '.repeat(50_000) };
      expect(SummarizeInputSchema.safeParse(input).success).toBe(true);
    });
  });

  describe('ExtractInputSchema', () => {
    it('should accept valid extract input', () => {
      const input = {
        noteId: '550e8400-e29b-41d4-a716-446655440000',
        physicianId: 'PHY001',
        transcript: 'Test transcript',
      };
      expect(ExtractInputSchema.safeParse(input).success).toBe(true);
    });

    it('should reject invalid noteId', () => {
      const input = {
        noteId: 'invalid-uuid',
        physicianId: 'PHY001',
        transcript: 'Test',
      };
      expect(ExtractInputSchema.safeParse(input).success).toBe(false);
    });

    it('should reject missing physicianId', () => {
      const input = {
        noteId: '550e8400-e29b-41d4-a716-446655440000',
        transcript: 'Test',
      };
      expect(ExtractInputSchema.safeParse(input).success).toBe(false);
    });

    it('should reject missing transcript', () => {
      const input = {
        noteId: '550e8400-e29b-41d4-a716-446655440000',
        physicianId: 'PHY001',
      };
      expect(ExtractInputSchema.safeParse(input).success).toBe(false);
    });
  });

  describe('CreateTaskInputSchema', () => {
    it('should accept valid task input', () => {
      const input = {
        physicianId: 'PHY001',
        taskText: 'Follow up with patient',
      };
      expect(CreateTaskInputSchema.safeParse(input).success).toBe(true);
    });

    it('should reject missing physicianId', () => {
      const input = { taskText: 'Follow up' };
      expect(CreateTaskInputSchema.safeParse(input).success).toBe(false);
    });

    it('should reject missing taskText', () => {
      const input = { physicianId: 'PHY001' };
      expect(CreateTaskInputSchema.safeParse(input).success).toBe(false);
    });

    it('should reject empty taskText', () => {
      const input = { physicianId: 'PHY001', taskText: '' };
      expect(CreateTaskInputSchema.safeParse(input).success).toBe(false);
    });

    it('should accept taskText at max length', () => {
      const input = {
        physicianId: 'PHY001',
        taskText: 'a'.repeat(500),
      };
      expect(CreateTaskInputSchema.safeParse(input).success).toBe(true);
    });

    it('should reject taskText exceeding max length', () => {
      const input = {
        physicianId: 'PHY001',
        taskText: 'a'.repeat(501),
      };
      expect(CreateTaskInputSchema.safeParse(input).success).toBe(false);
    });

    it('should accept taskText with special characters', () => {
      const input = {
        physicianId: 'PHY001',
        taskText: 'Task: Follow-up @10am #urgent',
      };
      expect(CreateTaskInputSchema.safeParse(input).success).toBe(true);
    });
  });

  describe('UpdateTaskInputSchema', () => {
    it('should accept valid update with taskId only', () => {
      const input = { taskId: '550e8400-e29b-41d4-a716-446655440000' };
      expect(UpdateTaskInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept update with completed flag', () => {
      const input = {
        taskId: '550e8400-e29b-41d4-a716-446655440000',
        completed: true,
      };
      expect(UpdateTaskInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept update with deleted flag', () => {
      const input = {
        taskId: '550e8400-e29b-41d4-a716-446655440000',
        deleted: true,
      };
      expect(UpdateTaskInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept update with both flags', () => {
      const input = {
        taskId: '550e8400-e29b-41d4-a716-446655440000',
        completed: true,
        deleted: false,
      };
      expect(UpdateTaskInputSchema.safeParse(input).success).toBe(true);
    });

    it('should reject missing taskId', () => {
      const input = { completed: true };
      expect(UpdateTaskInputSchema.safeParse(input).success).toBe(false);
    });

    it('should reject invalid taskId', () => {
      const input = { taskId: 'invalid-uuid', completed: true };
      expect(UpdateTaskInputSchema.safeParse(input).success).toBe(false);
    });

    it('should handle null completed flag', () => {
      const input = {
        taskId: '550e8400-e29b-41d4-a716-446655440000',
        completed: null,
      };
      const result = UpdateTaskInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('validateInput helper', () => {
    it('should return data on successful validation', () => {
      const input = { physicianId: 'PHY001' };
      const result = validateInput(PlaybookInputSchema, input);
      expect(result.data).toBeDefined();
      expect(result.errorResponse).toBeUndefined();
      expect(result.data?.physicianId).toBe('PHY001');
    });

    it('should return error response on validation failure', () => {
      const input = { physicianId: '' };
      const result = validateInput(PlaybookInputSchema, input);
      expect(result.errorResponse).toBeDefined();
      expect(result.data).toBeUndefined();
      expect(result.errorResponse?.status).toBe(400);
    });

    it('should include error message in response', async () => {
      const input = {};
      const result = validateInput(PlaybookInputSchema, input);
      expect(result.errorResponse).toBeDefined();
      const json = await result.errorResponse?.json();
      expect(json.error).toBeDefined();
      expect(typeof json.error).toBe('string');
    });

    it('should handle multiple validation errors', async () => {
      const input = { physicianId: '', transcript: '' };
      const result = validateInput(EvalSubmitInputSchema, input);
      expect(result.errorResponse).toBeDefined();
      const json = await result.errorResponse?.json();
      expect(json.error).toContain(';');
    });

    it('should preserve data structure on success', () => {
      const input = {
        physicianId: 'PHY001',
        transcript: 'Test transcript with content',
      };
      const result = validateInput(EvalSubmitInputSchema, input);
      expect(result.data?.physicianId).toBe('PHY001');
      expect(result.data?.transcript).toBe('Test transcript with content');
    });

    it('should validate complex nested schemas', () => {
      const input = {
        physicianId: 'PHY001',
        taskText: 'Valid task',
      };
      const result = validateInput(CreateTaskInputSchema, input);
      expect(result.data).toBeDefined();
    });

    it('should return 400 status code on validation error', () => {
      const result = validateInput(PlaybookInputSchema, {});
      expect(result.errorResponse?.status).toBe(400);
    });

    it('should handle non-object input', () => {
      const result = validateInput(PlaybookInputSchema, 'not an object');
      expect(result.errorResponse).toBeDefined();
    });

    it('should handle null input', () => {
      const result = validateInput(PlaybookInputSchema, null);
      expect(result.errorResponse).toBeDefined();
    });

    it('should handle undefined input', () => {
      const result = validateInput(PlaybookInputSchema, undefined);
      expect(result.errorResponse).toBeDefined();
    });
  });

  describe('integration scenarios', () => {
    it('should validate complete playbook request', () => {
      const input = { physicianId: 'PHY_COMPREHENSIVE_001' };
      const result = validateInput(PlaybookInputSchema, input);
      expect(result.data).toBeDefined();
    });

    it('should validate complete eval submit request', () => {
      const input = {
        physicianId: 'PHY001',
        transcript: 'Rep: Question? AI: Answer.',
      };
      const result = validateInput(EvalSubmitInputSchema, input);
      expect(result.data).toBeDefined();
    });

    it('should validate complete extract request', () => {
      const input = {
        noteId: '550e8400-e29b-41d4-a716-446655440000',
        physicianId: 'PHY001',
        transcript: 'Full transcript content here',
      };
      const result = validateInput(ExtractInputSchema, input);
      expect(result.data).toBeDefined();
    });

    it('should validate create task request', () => {
      const input = {
        physicianId: 'PHY001',
        taskText: 'Schedule follow-up appointment',
      };
      const result = validateInput(CreateTaskInputSchema, input);
      expect(result.data).toBeDefined();
    });

    it('should validate update task request', () => {
      const input = {
        taskId: '550e8400-e29b-41d4-a716-446655440000',
        completed: true,
      };
      const result = validateInput(UpdateTaskInputSchema, input);
      expect(result.data).toBeDefined();
    });

    it('should reject inconsistent types across schemas', () => {
      const input = {
        physicianId: 123,
      };
      const result = validateInput(PlaybookInputSchema, input);
      expect(result.errorResponse).toBeDefined();
    });

    it('should handle empty object gracefully', () => {
      const result = validateInput(PlaybookInputSchema, {});
      expect(result.errorResponse).toBeDefined();
    });

    it('should validate with extra unknown fields', () => {
      const input = {
        physicianId: 'PHY001',
        unknownField: 'should be ignored',
      };
      const result = validateInput(PlaybookInputSchema, input);
      expect(result.data).toBeDefined();
    });
  });
});
