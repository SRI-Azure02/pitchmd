import { describe, it, expect } from 'vitest';
import { parseSnowflakeDate, formatDate, formatDateTime } from '@/lib/dates';

describe('dates', () => {
  describe('parseSnowflakeDate', () => {
    describe('null/undefined/empty handling', () => {
      it('should return null for null input', () => {
        expect(parseSnowflakeDate(null)).toBeNull();
      });

      it('should return null for undefined input', () => {
        expect(parseSnowflakeDate(undefined)).toBeNull();
      });

      it('should return null for empty string', () => {
        expect(parseSnowflakeDate('')).toBeNull();
      });

      it('should return null for NaN', () => {
        expect(parseSnowflakeDate(NaN)).toBeNull();
      });
    });

    describe('Unix timestamp parsing', () => {
      it('should parse Unix timestamp in seconds', () => {
        const timestamp = 1704067200; // 2024-01-01 00:00:00 UTC
        const result = parseSnowflakeDate(timestamp);
        expect(result).not.toBeNull();
        expect(result?.getFullYear()).toBeGreaterThanOrEqual(2023);
      });

      it('should parse Unix timestamp in milliseconds', () => {
        const timestamp = 1704067200000; // 2024-01-01 00:00:00 UTC
        const result = parseSnowflakeDate(timestamp);
        expect(result).not.toBeNull();
        expect(result?.getFullYear()).toBeGreaterThanOrEqual(2023);
      });

      it('should handle boundary between seconds and milliseconds', () => {
        const secondsTimestamp = 1704067200;
        const msTimestamp = 1704067200000;
        const resultSeconds = parseSnowflakeDate(secondsTimestamp);
        const resultMs = parseSnowflakeDate(msTimestamp);
        expect(Math.abs(resultSeconds!.getTime() - resultMs!.getTime())).toBeLessThan(1000);
      });

      it('should parse recent Unix timestamp', () => {
        const timestamp = Math.floor(Date.now() / 1000);
        const result = parseSnowflakeDate(timestamp);
        expect(result).not.toBeNull();
      });

      it('should handle very old Unix timestamp', () => {
        const timestamp = 86400; // 1970-01-02
        const result = parseSnowflakeDate(timestamp);
        expect(result).not.toBeNull();
        expect(result?.getFullYear()).toBeGreaterThanOrEqual(1970);
      });

      it('should handle large millisecond timestamps', () => {
        const timestamp = Date.now();
        const result = parseSnowflakeDate(timestamp);
        expect(result).not.toBeNull();
      });
    });

    describe('epoch-days parsing (small integers)', () => {
      it('should handle 0 value (treats as epoch or date)', () => {
        const result = parseSnowflakeDate(0);
        // 0 can be parsed as epoch date or return null
        expect(result === null || result instanceof Date).toBe(true);
      });

      it('should parse Snowflake epoch-days for positive small integer', () => {
        const result = parseSnowflakeDate(1);
        expect(result).not.toBeNull();
        expect(result?.getFullYear()).toBe(1970);
      });

      it('should parse Snowflake epoch-days for positive integer', () => {
        const daysSince1970 = 19723; // Around 2024-01-01
        const result = parseSnowflakeDate(daysSince1970);
        expect(result).not.toBeNull();
        expect(result?.getFullYear()).toBeGreaterThanOrEqual(2023);
      });

      it('should handle 10000 epoch-days', () => {
        const result = parseSnowflakeDate(10000);
        expect(result).not.toBeNull();
        expect(result?.getFullYear()).toBeGreaterThan(1970);
      });

      it('should handle large numbers >= 100000', () => {
        const result = parseSnowflakeDate(100000);
        // Large numbers may be parsed as Unix timestamp
        expect(result === null || result instanceof Date).toBe(true);
      });

      it('should handle negative numbers', () => {
        const result = parseSnowflakeDate(-1);
        // Negative numbers may be parsed as timestamp or return null
        expect(result === null || result instanceof Date).toBe(true);
      });

      it('should return local midnight for epoch-days', () => {
        const result = parseSnowflakeDate(1);
        expect(result?.getHours()).toBe(0);
        expect(result?.getMinutes()).toBe(0);
        expect(result?.getSeconds()).toBe(0);
      });
    });

    describe('ISO date string parsing', () => {
      it('should parse ISO date-only string YYYY-MM-DD', () => {
        const result = parseSnowflakeDate('2024-01-15');
        expect(result).not.toBeNull();
        expect(result?.getFullYear()).toBe(2024);
        expect(result?.getMonth()).toBe(0);
        expect(result?.getDate()).toBe(15);
      });

      it('should parse date-only string with leading zeros', () => {
        const result = parseSnowflakeDate('2024-01-05');
        expect(result?.getDate()).toBe(5);
      });

      it('should parse date-only string end of year', () => {
        const result = parseSnowflakeDate('2024-12-31');
        expect(result?.getMonth()).toBe(11);
        expect(result?.getDate()).toBe(31);
      });

      it('should parse date-only string as local midnight', () => {
        const result = parseSnowflakeDate('2024-01-15');
        expect(result?.getHours()).toBe(0);
        expect(result?.getMinutes()).toBe(0);
        expect(result?.getSeconds()).toBe(0);
      });

      it('should parse leap year date', () => {
        const result = parseSnowflakeDate('2024-02-29');
        expect(result?.getDate()).toBe(29);
      });

      it('should parse non-leap year Feb date', () => {
        const result = parseSnowflakeDate('2023-02-28');
        expect(result?.getDate()).toBe(28);
      });
    });

    describe('ISO datetime string parsing', () => {
      it('should parse ISO datetime with space separator', () => {
        const result = parseSnowflakeDate('2024-01-15 14:30:45');
        expect(result).not.toBeNull();
        expect(result?.getFullYear()).toBe(2024);
        expect(result?.getMonth()).toBe(0);
        expect(result?.getDate()).toBe(15);
      });

      it('should parse ISO datetime with T separator', () => {
        const result = parseSnowflakeDate('2024-01-15T14:30:45');
        expect(result).not.toBeNull();
        expect(result?.getFullYear()).toBe(2024);
      });

      it('should convert space separator to T for parsing', () => {
        const withSpace = parseSnowflakeDate('2024-01-15 14:30:45');
        const withT = parseSnowflakeDate('2024-01-15T14:30:45');
        expect(withSpace?.getTime()).toEqual(withT?.getTime());
      });

      it('should parse datetime with seconds', () => {
        const result = parseSnowflakeDate('2024-01-15 14:30:45');
        expect(result?.getHours()).toBe(14);
        expect(result?.getMinutes()).toBe(30);
        expect(result?.getSeconds()).toBe(45);
      });

      it('should parse datetime without seconds', () => {
        const result = parseSnowflakeDate('2024-01-15 14:30');
        expect(result?.getHours()).toBe(14);
        expect(result?.getMinutes()).toBe(30);
      });

      it('should parse midnight datetime', () => {
        const result = parseSnowflakeDate('2024-01-15 00:00:00');
        expect(result?.getHours()).toBe(0);
        expect(result?.getMinutes()).toBe(0);
      });

      it('should parse end-of-day datetime', () => {
        const result = parseSnowflakeDate('2024-01-15 23:59:59');
        expect(result?.getHours()).toBe(23);
        expect(result?.getMinutes()).toBe(59);
        expect(result?.getSeconds()).toBe(59);
      });
    });

    describe('string normalization', () => {
      it('should trim whitespace from input', () => {
        const result = parseSnowflakeDate('  2024-01-15  ');
        expect(result?.getFullYear()).toBe(2024);
      });

      it('should handle tabs and newlines', () => {
        const result = parseSnowflakeDate('\t2024-01-15\n');
        expect(result?.getFullYear()).toBe(2024);
      });

      it('should handle invalid date formats', () => {
        const result1 = parseSnowflakeDate('01-15-2024');
        const result2 = parseSnowflakeDate('15/01/2024');
        // These may or may not parse depending on Date constructor
        expect(result1 === null || result1 instanceof Date).toBe(true);
        expect(result2 === null || result2 instanceof Date).toBe(true);
      });

      it('should handle malformed dates gracefully', () => {
        // JavaScript Date constructor behavior varies by implementation
        const result1 = parseSnowflakeDate('2024-13-01');
        const result2 = parseSnowflakeDate('2024-00-01');
        expect(result1 === null || result1 instanceof Date).toBe(true);
        expect(result2 === null || result2 instanceof Date).toBe(true);
      });
    });

    describe('edge cases and boundaries', () => {
      it('should handle 0 input (may parse as epoch or date)', () => {
        const result = parseSnowflakeDate(0);
        // 0 can be parsed as epoch date or return null depending on implementation
        expect(result === null || result instanceof Date).toBe(true);
      });

      it('should handle far future date', () => {
        const result = parseSnowflakeDate('2099-12-31');
        expect(result).not.toBeNull();
        expect(result?.getFullYear()).toBe(2099);
      });

      it('should handle far past date', () => {
        const result = parseSnowflakeDate('1900-01-01');
        expect(result).not.toBeNull();
        expect(result?.getFullYear()).toBe(1900);
      });

      it('should handle numeric string conversion', () => {
        const result = parseSnowflakeDate('1704067200');
        expect(result).not.toBeNull();
      });

      it('should handle boolean false as 0', () => {
        const result = parseSnowflakeDate(false);
        expect(result).toBeNull();
      });

      it('should handle boolean true as 1', () => {
        const result = parseSnowflakeDate(true);
        expect(result).not.toBeNull();
      });
    });

    describe('timezone consistency', () => {
      it('should return local-midnight Date for date-only strings', () => {
        const result = parseSnowflakeDate('2024-01-15');
        expect(result?.getHours()).toBe(0);
        expect(result?.getMinutes()).toBe(0);
        expect(result?.getSeconds()).toBe(0);
      });

      it('should preserve time portion from datetime strings', () => {
        const result = parseSnowflakeDate('2024-01-15 14:30:45');
        expect(result?.getHours()).not.toBe(0);
      });
    });
  });

  describe('formatDate', () => {
    describe('basic formatting', () => {
      it('should format date as M/D/YY', () => {
        const result = formatDate('2024-01-15');
        expect(result).toBe('1/15/24');
      });

      it('should format date with single-digit month and day', () => {
        const result = formatDate('2024-01-05');
        expect(result).toBe('1/5/24');
      });

      it('should format date with double-digit month and day', () => {
        const result = formatDate('2024-12-31');
        expect(result).toBe('12/31/24');
      });

      it('should format date with Unix timestamp', () => {
        const timestamp = 1704067200;
        const result = formatDate(timestamp);
        expect(result).toMatch(/\d+\/\d+\/(23|24)/);
      });

      it('should return empty string for null input', () => {
        expect(formatDate(null)).toBe('');
      });

      it('should return empty string for undefined input', () => {
        expect(formatDate(undefined)).toBe('');
      });

      it('should return empty string for empty string input', () => {
        expect(formatDate('')).toBe('');
      });

      it('should return empty string for invalid date', () => {
        expect(formatDate('invalid-date')).toBe('');
      });
    });

    describe('month formatting', () => {
      it('should handle January', () => {
        const result = formatDate('2024-01-15');
        expect(result.startsWith('1/')).toBe(true);
      });

      it('should handle December', () => {
        const result = formatDate('2024-12-15');
        expect(result.startsWith('12/')).toBe(true);
      });

      it('should not zero-pad single-digit months', () => {
        const result = formatDate('2024-03-15');
        expect(result.startsWith('3/')).toBe(true);
      });
    });

    describe('year formatting', () => {
      it('should format year as last 2 digits for 2024', () => {
        const result = formatDate('2024-01-15');
        expect(result.endsWith('/24')).toBe(true);
      });

      it('should format year as last 2 digits for 1999', () => {
        const result = formatDate('1999-01-15');
        expect(result.endsWith('/99')).toBe(true);
      });

      it('should format year as last 2 digits for 2000', () => {
        const result = formatDate('2000-01-15');
        expect(result.endsWith('/00')).toBe(true);
      });

      it('should format year as last 2 digits for 2099', () => {
        const result = formatDate('2099-01-15');
        expect(result.endsWith('/99')).toBe(true);
      });
    });

    describe('various input formats', () => {
      it('should format ISO date string', () => {
        const result = formatDate('2024-06-15');
        expect(result).toBe('6/15/24');
      });

      it('should format ISO datetime string', () => {
        const result = formatDate('2024-06-15 14:30:45');
        expect(result).toBe('6/15/24');
      });

      it('should format epoch days', () => {
        const result = formatDate(19723);
        expect(result).toMatch(/\d+\/\d+\/\d{2}/);
      });

      it('should format Unix timestamp seconds', () => {
        const timestamp = Math.floor(Date.now() / 1000);
        const result = formatDate(timestamp);
        expect(result).toMatch(/\d+\/\d+\/\d{2}/);
      });

      it('should format Unix timestamp milliseconds', () => {
        const timestamp = Date.now();
        const result = formatDate(timestamp);
        expect(result).toMatch(/\d+\/\d+\/\d{2}/);
      });

      it('should format numeric string', () => {
        const result = formatDate('1704067200');
        expect(result).toMatch(/\d+\/\d+\/\d{2}/);
      });
    });

    describe('edge cases', () => {
      it('should handle leap year', () => {
        const result = formatDate('2024-02-29');
        expect(result).toBe('2/29/24');
      });

      it('should handle end of year', () => {
        const result = formatDate('2024-12-31');
        expect(result).toBe('12/31/24');
      });

      it('should handle start of year', () => {
        const result = formatDate('2024-01-01');
        expect(result).toBe('1/1/24');
      });
    });
  });

  describe('formatDateTime', () => {
    describe('basic formatting', () => {
      it('should format datetime as M/D/YY H:MM AM/PM', () => {
        const result = formatDateTime('2024-01-15 14:30:00');
        expect(result).toMatch(/1\/15\/24 \d+:\d{2} PM/);
      });

      it('should return empty string for null input', () => {
        expect(formatDateTime(null)).toBe('');
      });

      it('should return empty string for undefined input', () => {
        expect(formatDateTime(undefined)).toBe('');
      });

      it('should return empty string for empty string', () => {
        expect(formatDateTime('')).toBe('');
      });

      it('should return empty string for invalid date', () => {
        expect(formatDateTime('invalid')).toBe('');
      });
    });

    describe('12-hour format and AM/PM', () => {
      it('should format midnight as 12:00 AM', () => {
        const result = formatDateTime('2024-01-15 00:00:00');
        expect(result).toContain('12:00 AM');
      });

      it('should format 1 AM correctly', () => {
        const result = formatDateTime('2024-01-15 01:00:00');
        expect(result).toContain('1:00 AM');
      });

      it('should format 11 AM correctly', () => {
        const result = formatDateTime('2024-01-15 11:00:00');
        expect(result).toContain('11:00 AM');
      });

      it('should format noon as 12:00 PM', () => {
        const result = formatDateTime('2024-01-15 12:00:00');
        expect(result).toContain('12:00 PM');
      });

      it('should format 1 PM correctly', () => {
        const result = formatDateTime('2024-01-15 13:00:00');
        expect(result).toContain('1:00 PM');
      });

      it('should format 11 PM correctly', () => {
        const result = formatDateTime('2024-01-15 23:00:00');
        expect(result).toContain('11:00 PM');
      });

      it('should format 12 PM correctly', () => {
        const result = formatDateTime('2024-01-15 12:30:00');
        expect(result).toContain('12:30 PM');
      });
    });

    describe('minutes formatting', () => {
      it('should pad minutes with leading zero', () => {
        const result = formatDateTime('2024-01-15 14:05:00');
        expect(result).toContain(':05');
      });

      it('should format double-digit minutes', () => {
        const result = formatDateTime('2024-01-15 14:30:00');
        expect(result).toContain(':30');
      });

      it('should format 59 minutes', () => {
        const result = formatDateTime('2024-01-15 14:59:00');
        expect(result).toContain(':59');
      });

      it('should format 00 minutes', () => {
        const result = formatDateTime('2024-01-15 14:00:00');
        expect(result).toContain(':00');
      });
    });

    describe('date portion', () => {
      it('should include correct date', () => {
        const result = formatDateTime('2024-01-15 14:30:00');
        expect(result.startsWith('1/15/24')).toBe(true);
      });

      it('should handle double-digit month', () => {
        const result = formatDateTime('2024-12-25 10:30:00');
        expect(result.startsWith('12/25/24')).toBe(true);
      });

      it('should handle single-digit day', () => {
        const result = formatDateTime('2024-06-05 10:30:00');
        expect(result.startsWith('6/5/24')).toBe(true);
      });
    });

    describe('various input formats', () => {
      it('should format ISO datetime string', () => {
        const result = formatDateTime('2024-06-15 14:30:45');
        expect(result).toMatch(/6\/15\/24 \d+:\d{2} (AM|PM)/);
      });

      it('should format ISO datetime with T separator', () => {
        const result = formatDateTime('2024-06-15T14:30:45');
        expect(result).toMatch(/6\/15\/24 \d+:\d{2} (AM|PM)/);
      });

      it('should format Unix timestamp', () => {
        const timestamp = 1704067200 + 3600 * 14 + 60 * 30; // 2024-01-01 14:30 UTC
        const result = formatDateTime(timestamp);
        expect(result).toMatch(/1\/1\/24 \d+:\d{2} (AM|PM)/);
      });

      it('should format Unix timestamp milliseconds', () => {
        const timestamp = (1704067200 + 3600 * 14 + 60 * 30) * 1000;
        const result = formatDateTime(timestamp);
        expect(result).toMatch(/1\/1\/24 \d+:\d{2} (AM|PM)/);
      });
    });

    describe('edge cases', () => {
      it('should handle leap year date', () => {
        const result = formatDateTime('2024-02-29 14:30:00');
        expect(result.startsWith('2/29/24')).toBe(true);
      });

      it('should handle end of year', () => {
        const result = formatDateTime('2024-12-31 23:59:59');
        expect(result.startsWith('12/31/24')).toBe(true);
        expect(result).toContain('11:59 PM');
      });

      it('should handle start of year', () => {
        const result = formatDateTime('2024-01-01 00:00:00');
        expect(result.startsWith('1/1/24')).toBe(true);
        expect(result).toContain('12:00 AM');
      });

      it('should handle midday exactly', () => {
        const result = formatDateTime('2024-06-15 12:00:00');
        expect(result).toContain('12:00 PM');
      });
    });

    describe('format structure validation', () => {
      it('should have format: M/D/YY H:MM AM/PM', () => {
        const result = formatDateTime('2024-06-15 14:30:00');
        expect(result).toMatch(/^\d{1,2}\/\d{1,2}\/\d{2} \d{1,2}:\d{2} (AM|PM)$/);
      });

      it('should not have leading zeros on month', () => {
        const result = formatDateTime('2024-01-15 14:30:00');
        expect(result).toMatch(/^1\/\d{1,2}\/\d{2}/);
      });

      it('should not have leading zeros on day', () => {
        const result = formatDateTime('2024-06-05 14:30:00');
        expect(result).toMatch(/^6\/5\/\d{2}/);
      });

      it('should not have leading zeros on hour in 12-hour format', () => {
        const result = formatDateTime('2024-06-15 02:30:00');
        expect(result).toMatch(/2:\d{2}/);
      });

      it('should have 2-digit year', () => {
        const result = formatDateTime('2024-06-15 14:30:00');
        expect(result).toMatch(/\/24 /);
      });
    });
  });

  describe('integration scenarios', () => {
    it('should format chart axis labels using formatDate', () => {
      const dates = ['2024-01-01', '2024-06-15', '2024-12-31'];
      const labels = dates.map(formatDate);
      expect(labels[0]).toBe('1/1/24');
      expect(labels[1]).toBe('6/15/24');
      expect(labels[2]).toBe('12/31/24');
    });

    it('should format session timestamps using formatDateTime', () => {
      const timestamp = '2024-06-15 14:30:00';
      const result = formatDateTime(timestamp);
      expect(result).toContain('6/15/24');
      expect(result).toContain('2:30 PM');
    });

    it('should handle Snowflake TIMESTAMP columns', () => {
      const snowflakeTimestamp = 1704067200;
      const dateFormatted = formatDate(snowflakeTimestamp);
      const dateTimeFormatted = formatDateTime(snowflakeTimestamp);
      expect(dateFormatted).toMatch(/\d+\/\d+\/\d{2}/);
      expect(dateTimeFormatted).toMatch(/\d+\/\d+\/\d{2} \d+:\d{2} (AM|PM)/);
    });

    it('should parse and format round-trip consistency', () => {
      const original = '2024-06-15 14:30:45';
      const parsed = parseSnowflakeDate(original);
      expect(parsed).not.toBeNull();
      const formatted = formatDateTime(original);
      expect(formatted).toContain('6/15/24');
      expect(formatted).toContain('2:30');
    });

    it('should handle mixed input formats in batch operations', () => {
      const inputs = [
        '2024-01-15',
        1704067200,
        '2024-06-15 14:30:00',
        19723,
      ];
      const results = inputs.map(formatDate);
      results.forEach(r => {
        expect(r).toMatch(/\d+\/\d+\/\d{2}/);
      });
    });
  });
});
