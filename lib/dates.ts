/**
 * Shared Snowflake date utilities.
 *
 * Snowflake returns dates in several formats depending on the column type:
 *  - Integer: days since 1970-01-01 (::DATE cast)
 *  - Large integer: Unix epoch seconds or milliseconds (TIMESTAMP)
 *  - String: ISO "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS"
 *
 * new Date("YYYY-MM-DD") parses as UTC midnight, which shifts to the previous
 * calendar day in US timezones.  parseSnowflakeDate always returns a local-
 * midnight Date to avoid this offset.
 */
export function parseSnowflakeDate(val: any): Date | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!isNaN(n)) {
    // Large number: Unix timestamp (seconds or ms)
    if (n > 1_000_000_000) return new Date(n > 9_999_999_999 ? n : n * 1000);
    // Small positive integer: Snowflake epoch-days (days since 1970-01-01)
    if (n > 0 && Number.isInteger(n) && n < 100_000) {
      const utc = new Date(n * 86_400_000);
      return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
    }
  }
  const str = String(val).trim();
  // ISO date-only "YYYY-MM-DD" — parse as local midnight
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  // ISO datetime string — replace space separator with T for reliable parsing
  const d = new Date(str.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

/** Format as M/D/YY (e.g. "3/22/26") — used in chart axis labels. */
export function formatDate(val: any): string {
  const d = parseSnowflakeDate(val);
  if (!d) return '';
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

/** Format as M/D/YY H:MM AM/PM — used in evaluation session timestamps. */
export function formatDateTime(val: any): string {
  const d = parseSnowflakeDate(val);
  if (!d) return '';
  const h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)} ${h12}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}
