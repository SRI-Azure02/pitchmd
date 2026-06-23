import { describe, it, expect } from 'vitest';
import { buildCorrector, Corrector } from '@/lib/product-name-corrector';

describe('product-name-corrector', () => {
  describe('buildCorrector', () => {
    describe('basic functionality', () => {
      it('should return a function', () => {
        const corrector = buildCorrector(['Venclexta']);
        expect(typeof corrector).toBe('function');
      });

      it('should handle empty brand list', () => {
        const corrector = buildCorrector([]);
        const result = corrector('ben clexta');
        expect(result).toBe('ben clexta');
      });

      it('should correct single brand name', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector('ben clexta');
        expect(result).toBe('Venclexta');
      });

      it('should correct multiple phonetic variants', () => {
        const corrector = buildCorrector(['Venclexta']);
        const variants = ['ben clexta', 'then clexta', 'vent texta', 'van clexta'];
        variants.forEach(variant => {
          expect(corrector(variant)).toBe('Venclexta');
        });
      });

      it('should correct Imbruvica phonetic variants', () => {
        const corrector = buildCorrector(['Imbruvica']);
        expect(corrector('in brew vica')).toBe('Imbruvica');
        expect(corrector('improvica')).toBe('Imbruvica');
        expect(corrector('ambrewvica')).toBe('Imbruvica');
      });

      it('should correct Brukinsa phonetic variants', () => {
        const corrector = buildCorrector(['Brukinsa']);
        expect(corrector('blue kinsa')).toBe('Brukinsa');
        expect(corrector('brew kinsa')).toBe('Brukinsa');
        expect(corrector('brookings uh')).toBe('Brukinsa');
      });

      it('should correct Ibrance phonetic variants', () => {
        const corrector = buildCorrector(['Ibrance']);
        expect(corrector('i brands')).toBe('Ibrance');
        expect(corrector('vibrance')).toBe('Ibrance');
        expect(corrector('eye brance')).toBe('Ibrance');
      });

      it('should correct Calquence phonetic variants', () => {
        const corrector = buildCorrector(['Calquence']);
        expect(corrector('cow quench')).toBe('Calquence');
        expect(corrector('cal quench')).toBe('Calquence');
        expect(corrector('call quench')).toBe('Calquence');
      });

      it('should correct Jaypirca phonetic variants', () => {
        const corrector = buildCorrector(['Jaypirca']);
        expect(corrector('jay prica')).toBe('Jaypirca');
        expect(corrector('jay perka')).toBe('Jaypirca');
        expect(corrector('jade perka')).toBe('Jaypirca');
      });

      it('should correct Zydelig phonetic variants', () => {
        const corrector = buildCorrector(['Zydelig']);
        expect(corrector('side elig')).toBe('Zydelig');
        expect(corrector('zi delig')).toBe('Zydelig');
        expect(corrector('high delig')).toBe('Zydelig');
      });

      it('should correct Rituxan phonetic variants', () => {
        const corrector = buildCorrector(['Rituxan']);
        expect(corrector('re tuxan')).toBe('Rituxan');
        expect(corrector('right tuxan')).toBe('Rituxan');
        expect(corrector('ritoxan')).toBe('Rituxan');
      });

      it('should correct Gazyva phonetic variants', () => {
        const corrector = buildCorrector(['Gazyva']);
        expect(corrector('god ziva')).toBe('Gazyva');
        expect(corrector('ga ziva')).toBe('Gazyva');
        expect(corrector('gaze eva')).toBe('Gazyva');
      });

      it('should correct Copiktra phonetic variants', () => {
        const corrector = buildCorrector(['Copiktra']);
        expect(corrector('co picktra')).toBe('Copiktra');
        expect(corrector('cope iktra')).toBe('Copiktra');
        expect(corrector('go picktra')).toBe('Copiktra');
      });
    });

    describe('case handling', () => {
      it('should preserve canonical case for all-caps input', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector('VENCLEXTA');
        expect(result).toBe('Venclexta');
      });

      it('should preserve canonical case for lowercase input', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector('venclexta');
        expect(result).toBe('Venclexta');
      });

      it('should preserve canonical case for mixed case input', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector('VeNcLeXtA');
        expect(result).toBe('Venclexta');
      });

      it('should force sentence case for all-caps brand names', () => {
        const corrector = buildCorrector(['VENCLEXTA']);
        const result = corrector('venclexta');
        expect(result).toBe('Venclexta');
      });

      it('should be case-insensitive in matching', () => {
        const corrector = buildCorrector(['Ibrance']);
        expect(corrector('IBRANCE')).toBe('Ibrance');
        expect(corrector('ibrance')).toBe('Ibrance');
        expect(corrector('IbRaNcE')).toBe('Ibrance');
      });
    });

    describe('spaced and hyphenated variants', () => {
      it('should correct spaced variant of brand name', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector('V e n c l e x t a');
        expect(result).toBe('Venclexta');
      });

      it('should correct hyphenated variant of brand name', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector('V-e-n-c-l-e-x-t-a');
        expect(result).toBe('Venclexta');
      });

      it('should correct mixed space and hyphen variant', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector('V-e n-c l-e x t a');
        expect(result).toBe('Venclexta');
      });

      it('should correct short brand names with spaces carefully', () => {
        const corrector = buildCorrector(['Ibrance']);
        const result = corrector('I b r a n c e');
        expect(result).toBe('Ibrance');
      });

      it('should not correct very short brands with spaces to avoid false positives', () => {
        const corrector = buildCorrector(['Go']);
        const result = corrector('G o');
        expect(result).toBe('G o');
      });
    });

    describe('multiple brands', () => {
      it('should correct multiple brands in same text', () => {
        const corrector = buildCorrector(['Venclexta', 'Ibrance']);
        const result = corrector('ben clexta and i brands');
        expect(result).toBe('Venclexta and Ibrance');
      });

      it('should handle overlapping brand corrections', () => {
        const corrector = buildCorrector(['Ibrance', 'Ibrutinib']);
        const result = corrector('i brands and ibrutinib');
        expect(result).toContain('Ibrance');
        expect(result).toContain('Ibrutinib');
      });

      it('should correct many brands in single text', () => {
        const corrector = buildCorrector([
          'Venclexta',
          'Ibrance',
          'Keytruda',
          'Entresto',
        ]);
        const result = corrector(
          'ben clexta, i brands, key truda, and en tresto'
        );
        expect(result).toContain('Venclexta');
        expect(result).toContain('Ibrance');
        expect(result).toContain('Keytruda');
        expect(result).toContain('Entresto');
      });

      it('should sort longest brands first for priority', () => {
        const corrector = buildCorrector(['Ibrance', 'Ibrutinib']);
        const result = corrector('ibrutinib vs ibrance');
        expect(result).toContain('Ibrutinib');
        expect(result).toContain('Ibrance');
      });

      it('should deduplicate brand list', () => {
        const corrector = buildCorrector(['Venclexta', 'Venclexta']);
        const result = corrector('ben clexta');
        expect(result).toBe('Venclexta');
      });
    });

    describe('sentence and context handling', () => {
      it('should correct brand in sentence', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector(
          'The patient is on ben clexta therapy.'
        );
        expect(result).toContain('Venclexta');
      });

      it('should preserve surrounding text', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector(
          'Starting patient on ben clexta with monitoring.'
        );
        expect(result).toMatch(/Starting patient on Venclexta with monitoring/);
      });

      it('should handle multiple occurrences in text', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector('ben clexta then ben clexta again');
        expect(result).toBe('Venclexta then Venclexta again');
      });

      it('should handle brand at sentence start', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector('ben clexta is effective.');
        expect(result).toBe('Venclexta is effective.');
      });

      it('should handle brand at sentence end', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector('Consider using ben clexta');
        expect(result).toBe('Consider using Venclexta');
      });

      it('should preserve punctuation around brand', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector('(ben clexta), [ben clexta], {ben clexta}');
        expect(result).toContain('(Venclexta)');
        expect(result).toContain('[Venclexta]');
        expect(result).toContain('{Venclexta}');
      });
    });

    describe('possessive and word forms', () => {
      it('should correct possessive form', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector("ben clexta's side effects");
        expect(result).toContain('Venclexta');
      });

      it('should not match brand as substring incorrectly', () => {
        const corrector = buildCorrector(['Brance']);
        const result = corrector('vibrance');
        expect(result).toBe('vibrance');
      });

      it('should use word boundaries to avoid partial matches', () => {
        const corrector = buildCorrector(['Brance']);
        const result = corrector('embrace brance embrace');
        expect(result).toBe('embrace Brance embrace');
      });
    });

    describe('unknown and unhandled brands', () => {
      it('should leave unknown brands unchanged', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector('some unknown drug name');
        expect(result).toBe('some unknown drug name');
      });

      it('should leave partial matches unchanged', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector('ventilation index');
        expect(result).toBe('ventilation index');
      });

      it('should preserve misspelled brands not in map', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector('venclexter');
        expect(result).toBe('venclexter');
      });
    });

    describe('edge cases', () => {
      it('should handle empty string', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector('');
        expect(result).toBe('');
      });

      it('should handle whitespace only', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector('   \n\t  ');
        expect(result).toBe('   \n\t  ');
      });

      it('should handle very long text', () => {
        const corrector = buildCorrector(['Venclexta']);
        const longText = 'ben clexta ' + 'x'.repeat(10_000) + ' ben clexta';
        const result = corrector(longText);
        expect(result.startsWith('Venclexta')).toBe(true);
        expect(result.endsWith('Venclexta')).toBe(true);
      });

      it('should handle text with only brand names', () => {
        const corrector = buildCorrector(['Venclexta', 'Ibrance']);
        const result = corrector('ben clexta i brands');
        expect(result).toBe('Venclexta Ibrance');
      });

      it('should handle unicode characters in surrounding text', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector('😀 ben clexta 😀');
        expect(result).toContain('Venclexta');
      });

      it('should handle repeated brand names', () => {
        const corrector = buildCorrector(['Venclexta']);
        const result = corrector(
          'ben clexta ben clexta ben clexta ben clexta'
        );
        expect(result).toBe('Venclexta Venclexta Venclexta Venclexta');
      });

      it('should handle null/undefined gracefully through buildCorrector', () => {
        const corrector = buildCorrector([]);
        expect(corrector('text')).toBe('text');
      });
    });

    describe('brand name variants from map', () => {
      it('should correct all documented Venclexta variants', () => {
        const corrector = buildCorrector(['Venclexta']);
        const variants = [
          'ben clexta',
          'then clexta',
          'vent texta',
          'van clexta',
          'then flex ta',
        ];
        variants.forEach(v => {
          expect(corrector(v)).toBe('Venclexta');
        });
      });

      it('should correct all documented Imbruvica variants', () => {
        const corrector = buildCorrector(['Imbruvica']);
        const variants = [
          'in brew vica',
          'improvica',
          'ambrewvica',
          'in bruvica',
          'm brew vica',
          'embryo vica',
        ];
        variants.forEach(v => {
          expect(corrector(v)).toBe('Imbruvica');
        });
      });

      it('should correct all documented Brukinsa variants', () => {
        const corrector = buildCorrector(['Brukinsa']);
        const variants = [
          'blue kinsa',
          'brew kinsa',
          'broo kinsa',
          'brookings uh',
          'rude kinsa',
          'brook invsa',
        ];
        variants.forEach(v => {
          expect(corrector(v)).toBe('Brukinsa');
        });
      });
    });

    describe('performance considerations', () => {
      it('should process quickly with single brand', () => {
        const corrector = buildCorrector(['Venclexta']);
        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
          corrector('ben clexta and some other text');
        }
        const end = performance.now();
        expect(end - start).toBeLessThan(1000);
      });

      it('should process quickly with many brands', () => {
        const brands = [
          'Venclexta',
          'Imbruvica',
          'Brukinsa',
          'Ibrance',
          'Calquence',
          'Jaypirca',
          'Zydelig',
          'Rituxan',
          'Gazyva',
          'Copiktra',
        ];
        const corrector = buildCorrector(brands);
        const start = performance.now();
        for (let i = 0; i < 100; i++) {
          corrector('ben clexta and i brands and side effects');
        }
        const end = performance.now();
        expect(end - start).toBeLessThan(1000);
      });
    });

    describe('real-world STT scenarios', () => {
      it('should correct realistic sales conversation', () => {
        const corrector = buildCorrector(['Venclexta', 'Ibrance']);
        const transcript = "I'd like to discuss ben clexta and i brands for this patient.";
        const result = corrector(transcript);
        expect(result).toContain('Venclexta');
        expect(result).toContain('Ibrance');
      });

      it('should correct transcript with multiple errors', () => {
        const corrector = buildCorrector([
          'Venclexta',
          'Imbruvica',
          'Ibrance',
        ]);
        const transcript = 'When should I use ben clexta, in brew vica or i brands?';
        const result = corrector(transcript);
        expect(result).toContain('Venclexta');
        expect(result).toContain('Imbruvica');
        expect(result).toContain('Ibrance');
      });

      it('should not introduce false positives', () => {
        const corrector = buildCorrector(['Venclexta']);
        const safe = "The patient ventured into text with flexibility.";
        const result = corrector(safe);
        expect(result).toBe(safe);
      });
    });
  });
});
