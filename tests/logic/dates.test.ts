import { afterAll, describe, expect, it } from 'vitest';
import { addDays, daysBetween, formatYmd, parseYmd, todayLocal } from '../../src/quests/dates';

// The project has no Node type definitions, so declare the one global this file needs.
declare const process: { env: Record<string, string | undefined> };

// US daylight saving in 2026: clocks go forward on March 8 and back on November 1.
const originalTz = process.env.TZ;
const ZONES = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Australia/Sydney'];

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('todayLocal', () => {
  it('formats local calendar fields, not UTC', () => {
    expect(todayLocal(new Date(2026, 9, 3, 23, 59, 59))).toBe('2026-10-03');
    expect(todayLocal(new Date(2026, 0, 5, 0, 0, 1))).toBe('2026-01-05');
  });
});

describe('parseYmd / formatYmd', () => {
  it('round trips and parses as local midnight', () => {
    const date = parseYmd('2026-03-08');
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 2, 8, 0]);
    expect(formatYmd(date)).toBe('2026-03-08');
  });

  it('rejects malformed and impossible dates', () => {
    expect(() => parseYmd('2026-3-8')).toThrow(/YYYY-MM-DD/);
    expect(() => parseYmd('2026-02-30')).toThrow(/real calendar date/);
    expect(() => parseYmd('not a date')).toThrow();
  });
});

describe('addDays', () => {
  it('adds and subtracts across month and year ends', () => {
    expect(addDays('2026-10-03', 1)).toBe('2026-10-04');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-10-03', 0)).toBe('2026-10-03');
  });
});

describe('daysBetween', () => {
  it('counts whole days, positive when b is later', () => {
    expect(daysBetween('2026-10-03', '2026-10-03')).toBe(0);
    expect(daysBetween('2026-10-03', '2026-10-04')).toBe(1);
    expect(daysBetween('2026-10-04', '2026-10-03')).toBe(-1);
    expect(daysBetween('2026-12-25', '2027-01-01')).toBe(7);
  });

  for (const zone of ZONES) {
    it(`is DST-safe across the March and November boundaries in ${zone}`, () => {
      process.env.TZ = zone;
      // Guard against silently testing nothing: the zone must really be in effect.
      const winter = new Date(2026, 0, 15).getTimezoneOffset();
      const summer = new Date(2026, 6, 15).getTimezoneOffset();
      expect(zone === 'UTC' ? winter === summer : winter !== summer).toBe(true);
      // March 8, 2026 is a 23-hour day in the US; November 1, 2026 is a 25-hour day.
      expect(daysBetween('2026-03-07', '2026-03-08')).toBe(1);
      expect(daysBetween('2026-03-08', '2026-03-09')).toBe(1);
      expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
      expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30);
      expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1);
      expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1);
      expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
      expect(daysBetween('2026-10-01', '2026-11-30')).toBe(60);
      expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
      expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
      expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
      expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
      expect(addDays('2026-03-01', 14)).toBe('2026-03-15');
      expect(addDays('2026-10-25', 14)).toBe('2026-11-08');
    });
  }
});
