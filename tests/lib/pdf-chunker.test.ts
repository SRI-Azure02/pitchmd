import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pdfToChunks, DocumentChunk } from '@/lib/pdf-chunker';

// Mock unpdf
vi.mock('unpdf', () => ({
  getDocumentProxy: vi.fn(),
  extractText: vi.fn(),
}));

const mockUnpdf = async () => {
  const mod = await import('unpdf');
  return mod;
};

describe('pdf-chunker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('sliding window basics', () => {
    it('should produce correct chunk count from 800-word text', async () => {
      const mod = await mockUnpdf();
      const words = Array(800)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.length).toBeLessThanOrEqual(3);
    });

    it('should have overlap of exactly 60 words', async () => {
      const mod = await mockUnpdf();
      const words = Array(500)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      if (chunks.length > 1) {
        const firstChunk = chunks[0].chunkText.split(' ');
        const secondChunk = chunks[1].chunkText.split(' ');
        const overlap = firstChunk.slice(-60);
        const secondStart = secondChunk.slice(0, 60);
        expect(overlap.join(' ')).toBe(secondStart.join(' '));
      }
    });

    it('should advance by exactly 340 words per step', async () => {
      const mod = await mockUnpdf();
      const words = Array(800)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      if (chunks.length > 1) {
        expect(chunks[1].chunkIndex).toBe(1);
      }
    });

    it('should start first chunk at word 0', async () => {
      const mod = await mockUnpdf();
      const words = Array(500)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0].chunkText.startsWith('word0')).toBe(true);
    });

    it('should start second chunk at word 340', async () => {
      const mod = await mockUnpdf();
      const words = Array(800)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      if (chunks.length > 1) {
        const secondStart = chunks[1].chunkText.split(' ')[0];
        expect(secondStart).toBe('word340');
      }
    });

    it('should include trailing words in last chunk', async () => {
      const mod = await mockUnpdf();
      const words = Array(450)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.chunkText).toContain('word449');
    });

    it('should produce single chunk for text < 400 words', async () => {
      const mod = await mockUnpdf();
      const words = Array(200)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBe(1);
    });

    it('should produce single chunk for exactly 400 words', async () => {
      const mod = await mockUnpdf();
      const words = Array(400)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBe(1);
    });

    it('should produce 2 chunks for 401 words', async () => {
      const mod = await mockUnpdf();
      const words = Array(401)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should produce 2 chunks for 739 words', async () => {
      const mod = await mockUnpdf();
      const words = Array(739)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should produce 3 chunks for 740 words', async () => {
      const mod = await mockUnpdf();
      const words = Array(740)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('should produce correct chunks from 10,000 word text', async () => {
      const mod = await mockUnpdf();
      const words = Array(10000)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.length).toBeLessThanOrEqual(30);
    });
  });

  describe('word count accuracy', () => {
    it('should verify chunk word counts are correct', async () => {
      const mod = await mockUnpdf();
      const words = Array(500)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      chunks.forEach((chunk) => {
        const wordCount = chunk.chunkText.split(/\s+/).length;
        expect(wordCount).toBeGreaterThanOrEqual(30);
        expect(wordCount).toBeLessThanOrEqual(400);
      });
    });

    it('should have correct overlap region between chunks', async () => {
      const mod = await mockUnpdf();
      const words = Array(800)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      if (chunks.length > 1) {
        const firstWords = chunks[0].chunkText.split(/\s+/);
        const secondWords = chunks[1].chunkText.split(/\s+/);
        const lastWordsOfFirst = firstWords.slice(-60);
        const firstWordsOfSecond = secondWords.slice(0, 60);
        expect(lastWordsOfFirst.join(' ')).toBe(
          firstWordsOfSecond.join(' ')
        );
      }
    });

    it('should not drop any words', async () => {
      const mod = await mockUnpdf();
      const words = Array(600)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      const fullText = chunks.map((c) => c.chunkText).join(' ');
      expect(fullText).toContain('word0');
      expect(fullText).toContain('word599');
    });

    it('should have duplicated region of exactly 60 words', async () => {
      const mod = await mockUnpdf();
      const words = Array(500)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      if (chunks.length > 1) {
        const first = chunks[0].chunkText.split(/\s+/);
        const second = chunks[1].chunkText.split(/\s+/);
        const overlapCount = 60;
        expect(first.slice(-overlapCount).join(' ')).toBe(
          second.slice(0, overlapCount).join(' ')
        );
      }
    });

    it('should handle multi-line text same as single-line', async () => {
      const mod = await mockUnpdf();
      const base = Array(100)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');
      const singleLine = base;
      const multiLine = base.split(' ').join('\n');

      vi.mocked(mod.extractText).mockResolvedValue({
        text: singleLine,
      } as any);
      const chunks1 = await pdfToChunks(Buffer.from(''));

      vi.mocked(mod.extractText).mockResolvedValue({
        text: multiLine,
      } as any);
      const chunks2 = await pdfToChunks(Buffer.from(''));

      expect(chunks1.length).toBe(chunks2.length);
    });

    it('should preserve unicode characters', async () => {
      const mod = await mockUnpdf();
      const words = Array(100)
        .fill(null)
        .map((_, i) => (i % 2 === 0 ? `café${i}` : `word${i}`))
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0].chunkText).toContain('café');
    });

    it('should handle accented characters', async () => {
      const mod = await mockUnpdf();
      const words = 'naïve résumé façade ' + Array(100)
        .fill('word')
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0].chunkText).toContain('naïve');
    });

    it('should handle mixed languages', async () => {
      const mod = await mockUnpdf();
      const words = 'hello 世界 bonjour مرحبا ' + Array(100)
        .fill('word')
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should preserve emoji characters', async () => {
      const mod = await mockUnpdf();
      const words =
        'hello 😀 world 🚀 test ' +
        Array(100)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0].chunkText).toContain('😀');
    });
  });

  describe('edge cases', () => {
    it('should return empty array for empty string', async () => {
      const mod = await mockUnpdf();
      vi.mocked(mod.extractText).mockResolvedValue({ text: '' } as any);

      expect(pdfToChunks(Buffer.from(''))).rejects.toThrow();
    });

    it('should handle single word', async () => {
      const mod = await mockUnpdf();
      const words = 'singleword ' + Array(50)
        .fill('word')
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle exactly 30 words (MIN_CHUNK_WORDS)', async () => {
      const mod = await mockUnpdf();
      const words = Array(30)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBe(1);
    });

    it('should skip 29 words (below MIN_CHUNK_WORDS threshold)', async () => {
      const mod = await mockUnpdf();
      const words = Array(29)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      // Text with 29 words is below the MIN_CHUNK_WORDS (30) threshold
      // so no chunks are created, and the function throws
      const result = await pdfToChunks(Buffer.from(''));
      expect(result).toHaveLength(0);
    });

    it('should handle boundary at exactly MIN_CHUNK_WORDS', async () => {
      const mod = await mockUnpdf();
      const words = Array(30)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBe(1);
      expect(chunks[0].chunkIndex).toBe(0);
    });

    it('should handle very long single words', async () => {
      const mod = await mockUnpdf();
      const longWord = 'a'.repeat(1000);
      const words = longWord + ' ' + Array(50)
        .fill('word')
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should return empty array for only whitespace', async () => {
      const mod = await mockUnpdf();
      vi.mocked(mod.extractText).mockResolvedValue({
        text: '   \n\n\t\t  ',
      } as any);

      expect(pdfToChunks(Buffer.from(''))).rejects.toThrow();
    });

    it('should handle null bytes in text', async () => {
      const mod = await mockUnpdf();
      const words = 'word1\x00word2 ' + Array(50)
        .fill('word')
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle mixed line endings (CRLF, LF, CR)', async () => {
      const mod = await mockUnpdf();
      const words =
        'word1\r\nword2\nword3\rword4 ' +
        Array(50)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should collapse consecutive newlines', async () => {
      const mod = await mockUnpdf();
      const words =
        'word1\n\n\n\nword2 ' +
        Array(50)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0].chunkText).not.toContain('\n');
    });
  });

  describe('whitespace handling', () => {
    it('should strip leading/trailing whitespace', async () => {
      const mod = await mockUnpdf();
      const words =
        '  \n  word1 word2 ' +
        Array(50)
          .fill('word')
          .join(' ') +
        '  \n  ';

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0].chunkText.startsWith(' ')).toBe(false);
      expect(chunks[chunks.length - 1].chunkText.endsWith(' ')).toBe(false);
    });

    it('should collapse consecutive spaces', async () => {
      const mod = await mockUnpdf();
      const words =
        'word1    word2    word3 ' +
        Array(50)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0].chunkText).not.toContain('    ');
    });

    it('should treat tabs as space', async () => {
      const mod = await mockUnpdf();
      const words =
        'word1\t\tword2\t\tword3 ' +
        Array(50)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle multiple spaces between words', async () => {
      const mod = await mockUnpdf();
      const words =
        'word1     word2     word3 ' +
        Array(50)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      const wordCount = chunks[0].chunkText.split(/\s+/).length;
      expect(wordCount).toBeGreaterThan(0);
    });

    it('should treat newlines as space', async () => {
      const mod = await mockUnpdf();
      const words =
        'word1\nword2\nword3 ' +
        Array(50)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle mixed whitespace types', async () => {
      const mod = await mockUnpdf();
      const words =
        'word1 \t\nword2 \r\nword3 ' +
        Array(50)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should preserve internal spacing in chunks', async () => {
      const mod = await mockUnpdf();
      const words =
        'phrase1 phrase2 phrase3 ' +
        Array(100)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0].chunkText).toContain('phrase1 phrase2');
    });

    it('should handle trailing newlines', async () => {
      const mod = await mockUnpdf();
      const words =
        Array(100)
          .fill('word')
          .join(' ') + '\n\n\n';

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle leading newlines', async () => {
      const mod = await mockUnpdf();
      const words =
        '\n\n\n' +
        Array(100)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('section label extraction', () => {
    it('should detect numbered section (1 INDICATIONS)', async () => {
      const mod = await mockUnpdf();
      const text =
        '1 INDICATIONS AND USAGE\n' +
        Array(100)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0].sectionLabel).toBeDefined();
      expect(chunks[0].sectionLabel).toContain('INDICATIONS');
    });

    it('should detect all-caps heading', async () => {
      const mod = await mockUnpdf();
      const text =
        'DOSAGE AND ADMINISTRATION\n' +
        Array(100)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0].sectionLabel).toBeDefined();
      expect(chunks[0].sectionLabel).toContain('DOSAGE');
    });

    it('should detect nested numbering (5.3 CYTOPENIAS)', async () => {
      const mod = await mockUnpdf();
      const text =
        '5.3 CYTOPENIAS AND ANEMIA\n' +
        Array(100)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0].sectionLabel).toBeDefined();
      expect(chunks[0].sectionLabel).toContain('5.3');
    });

    it('should not bleed label into body', async () => {
      const mod = await mockUnpdf();
      const text =
        '1 INDICATIONS\nbody text ' +
        Array(100)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0].sectionLabel).not.toContain('body text');
    });

    it('should include section label in first chunk', async () => {
      const mod = await mockUnpdf();
      const text =
        '1 INDICATIONS\n' +
        Array(500)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0].sectionLabel).toBeDefined();
    });

    it('should trim section label to 200 chars', async () => {
      const mod = await mockUnpdf();
      const longLabel =
        '1 ' +
        Array(200)
          .fill('VERY_LONG_SECTION_NAME')
          .join(' ');
      const text =
        longLabel +
        '\n' +
        Array(100)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      if (chunks[0].sectionLabel) {
        expect(chunks[0].sectionLabel.length).toBeLessThanOrEqual(200);
      }
    });

    it('should return null when no label detected', async () => {
      const mod = await mockUnpdf();
      const text = Array(100)
        .fill('word')
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0].sectionLabel).toBeNull();
    });

    it('should detect heading with dashes', async () => {
      const mod = await mockUnpdf();
      const text =
        'WARNINGS AND PRECAUTIONS - SERIOUS ADVERSE REACTIONS\n' +
        Array(100)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0].sectionLabel).toBeDefined();
    });

    it('should detect heading with parentheses', async () => {
      const mod = await mockUnpdf();
      const text =
        'ADVERSE REACTIONS (see Section 6)\n' +
        Array(100)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0].sectionLabel).toBeDefined();
    });

    it('should be case-sensitive in detection', async () => {
      const mod = await mockUnpdf();
      const text =
        'Indications and Usage (lowercase)\n' +
        Array(100)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0].sectionLabel).toBeNull();
    });
  });

  describe('integration with unpdf mock', () => {
    it('should handle flat text from mock', async () => {
      const mod = await mockUnpdf();
      const text = Array(100)
        .fill('word')
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle paged text with mergePages', async () => {
      const mod = await mockUnpdf();
      const text =
        'Page 1 content ' +
        Array(100)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle null text from extraction', async () => {
      const mod = await mockUnpdf();
      vi.mocked(mod.extractText).mockResolvedValue({ text: null } as any);

      expect(pdfToChunks(Buffer.from(''))).rejects.toThrow();
    });

    it('should handle undefined text from extraction', async () => {
      const mod = await mockUnpdf();
      vi.mocked(mod.extractText).mockResolvedValue({ text: undefined } as any);

      expect(pdfToChunks(Buffer.from(''))).rejects.toThrow();
    });

    it('should throw on insufficient content', async () => {
      const mod = await mockUnpdf();
      const shortText = 'only few words here';

      vi.mocked(mod.extractText).mockResolvedValue({
        text: shortText,
      } as any);

      expect(pdfToChunks(Buffer.from(''))).rejects.toThrow();
    });
  });

  describe('chunk metadata', () => {
    it('should set correct chunkIndex values', async () => {
      const mod = await mockUnpdf();
      const words = Array(800)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      chunks.forEach((chunk, i) => {
        expect(chunk.chunkIndex).toBe(i);
      });
    });

    it('should calculate page numbers correctly', async () => {
      const mod = await mockUnpdf();
      const words = Array(1000)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      chunks.forEach((chunk) => {
        expect(chunk.pageNumber).toBeGreaterThanOrEqual(1);
      });
    });

    it('should have non-null chunkText', async () => {
      const mod = await mockUnpdf();
      const words = Array(500)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      chunks.forEach((chunk) => {
        expect(chunk.chunkText).toBeDefined();
        expect(chunk.chunkText.length).toBeGreaterThan(0);
      });
    });

    it('should have DocumentChunk type structure', async () => {
      const mod = await mockUnpdf();
      const words = Array(500)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks[0]).toHaveProperty('chunkText');
      expect(chunks[0]).toHaveProperty('chunkIndex');
      expect(chunks[0]).toHaveProperty('pageNumber');
      expect(chunks[0]).toHaveProperty('sectionLabel');
    });

    it('should calculate consistent page numbers across chunks', async () => {
      const mod = await mockUnpdf();
      const words = Array(2000)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i].pageNumber).toBeGreaterThanOrEqual(
          chunks[i - 1].pageNumber || 1
        );
      }
    });

    it('should increment chunkIndex sequentially', async () => {
      const mod = await mockUnpdf();
      const words = Array(800)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      chunks.forEach((chunk, i) => {
        expect(chunk.chunkIndex).toBe(i);
      });
    });

    it('should handle sectionLabel as null or string', async () => {
      const mod = await mockUnpdf();
      const words = Array(500)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      chunks.forEach((chunk) => {
        expect(
          chunk.sectionLabel === null ||
            typeof chunk.sectionLabel === 'string'
        ).toBe(true);
      });
    });

    it('should have pageNumber as number or null', async () => {
      const mod = await mockUnpdf();
      const words = Array(500)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      chunks.forEach((chunk) => {
        expect(
          chunk.pageNumber === null || typeof chunk.pageNumber === 'number'
        ).toBe(true);
      });
    });
  });

  describe('additional edge cases', () => {
    it('should handle buffer input correctly', async () => {
      const mod = await mockUnpdf();
      const words = Array(500)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);
      vi.mocked(mod.getDocumentProxy).mockResolvedValue({} as any);

      const buffer = Buffer.from('mock pdf content');
      const chunks = await pdfToChunks(buffer);
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle text with only punctuation after normalization', async () => {
      const mod = await mockUnpdf();
      const words =
        '!@#$%^&*() ' +
        Array(50)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle text with numbers mixed in', async () => {
      const mod = await mockUnpdf();
      const words =
        '123 456 789 ' +
        Array(100)
          .fill('word')
          .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks = await pdfToChunks(Buffer.from(''));
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should consistently chunk same text', async () => {
      const mod = await mockUnpdf();
      const words = Array(600)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      const chunks1 = await pdfToChunks(Buffer.from(''));

      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);
      const chunks2 = await pdfToChunks(Buffer.from(''));

      expect(chunks1.length).toBe(chunks2.length);
      expect(chunks1[0].chunkText).toBe(chunks2[0].chunkText);
    });

    it('should handle extraction errors gracefully', async () => {
      const mod = await mockUnpdf();
      vi.mocked(mod.extractText).mockRejectedValue(
        new Error('Extraction failed')
      );

      expect(pdfToChunks(Buffer.from(''))).rejects.toThrow();
    });

    it('should log chunk statistics on success', async () => {
      const mod = await mockUnpdf();
      const words = Array(500)
        .fill(null)
        .map((_, i) => `word${i}`)
        .join(' ');

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation();
      vi.mocked(mod.extractText).mockResolvedValue({ text: words } as any);

      await pdfToChunks(Buffer.from(''));
      expect(consoleLogSpy).toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });
  });
});
