import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../db/database.js';
import { seedDatabase } from '../db/seed.js';
import { queueEngine, getSortedWaitingTokens } from '../services/queueEngine.js';

describe('Issue #4: Implement Fair Priority Queue with Starvation Prevention', () => {
  beforeEach(() => {
    seedDatabase();
  });

  it('should serve higher priority tokens before newly arrived normal tokens', () => {
    const db = getDb();
    // Clear waiting tokens
    db.prepare(`DELETE FROM tokens WHERE status = 'WAITING'`).run();

    const now = new Date();
    const minsAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000).toISOString();

    // Normal token arrived 2 mins ago
    db.prepare(`
      INSERT INTO tokens (id, token_number, student_id, student_name, service_id, counter_id, priority, status, created_at)
      VALUES ('t-normal', 'LP-101', 'usr-student-aarav', 'Aarav', 'srv-lp', 'cntr-lp-2', 'NORMAL', 'WAITING', ?)
    `).run(minsAgo(2));

    // High token arrived 1 min ago
    db.prepare(`
      INSERT INTO tokens (id, token_number, student_id, student_name, service_id, counter_id, priority, status, created_at)
      VALUES ('t-high', 'LP-102', 'usr-student-ananya', 'Ananya', 'srv-lp', 'cntr-lp-2', 'HIGH', 'WAITING', ?)
    `).run(minsAgo(1));

    const sorted = getSortedWaitingTokens('srv-lp');
    expect(sorted[0].id).toBe('t-high');
    expect(sorted[1].id).toBe('t-normal');
  });

  it('should prevent starvation: promote long-waiting NORMAL token over fresh HIGH token', () => {
    const db = getDb();
    db.prepare(`DELETE FROM tokens WHERE status = 'WAITING'`).run();

    const now = new Date();
    const minsAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000).toISOString();

    // Normal token arrived 35 minutes ago (threshold is 15 min -> gets +2 boost -> effective priority 3)
    db.prepare(`
      INSERT INTO tokens (id, token_number, student_id, student_name, service_id, counter_id, priority, status, created_at)
      VALUES ('t-old-normal', 'LP-101', 'usr-student-aarav', 'Aarav', 'srv-lp', 'cntr-lp-2', 'NORMAL', 'WAITING', ?)
    `).run(minsAgo(35));

    // Fresh High token arrived 2 minutes ago (base 2 + 0 boost = 2)
    db.prepare(`
      INSERT INTO tokens (id, token_number, student_id, student_name, service_id, counter_id, priority, status, created_at)
      VALUES ('t-fresh-high', 'LP-102', 'usr-student-ananya', 'Ananya', 'srv-lp', 'cntr-lp-2', 'HIGH', 'WAITING', ?)
    `).run(minsAgo(2));

    const sorted = getSortedWaitingTokens('srv-lp');
    expect(sorted[0].id).toBe('t-old-normal');
    expect(sorted[1].id).toBe('t-fresh-high');
  });

  it('should maintain strict FIFO ordering for tokens with equal effective priority', () => {
    const db = getDb();
    db.prepare(`DELETE FROM tokens WHERE status = 'WAITING'`).run();

    const now = new Date();
    const minsAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000).toISOString();

    // Three normal tokens arriving at different times
    db.prepare(`
      INSERT INTO tokens (id, token_number, student_id, student_name, service_id, counter_id, priority, status, created_at)
      VALUES ('t1', 'LP-101', 'usr-student-aarav', 'Aarav', 'srv-lp', 'cntr-lp-2', 'NORMAL', 'WAITING', ?)
    `).run(minsAgo(10));

    db.prepare(`
      INSERT INTO tokens (id, token_number, student_id, student_name, service_id, counter_id, priority, status, created_at)
      VALUES ('t2', 'LP-102', 'usr-student-ananya', 'Ananya', 'srv-lp', 'cntr-lp-2', 'NORMAL', 'WAITING', ?)
    `).run(minsAgo(8));

    db.prepare(`
      INSERT INTO tokens (id, token_number, student_id, student_name, service_id, counter_id, priority, status, created_at)
      VALUES ('t3', 'LP-103', 'usr-student-rohan', 'Rohan', 'srv-lp', 'cntr-lp-2', 'NORMAL', 'WAITING', ?)
    `).run(minsAgo(5));

    const sorted = getSortedWaitingTokens('srv-lp');
    expect(sorted.map(t => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('should correctly prioritize URGENT > HIGH > NORMAL when all arrive simultaneously', () => {
    const db = getDb();
    db.prepare(`DELETE FROM tokens WHERE status = 'WAITING'`).run();

    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO tokens (id, token_number, student_id, student_name, service_id, counter_id, priority, status, created_at)
      VALUES ('t-norm', 'LP-101', 'usr-student-aarav', 'Aarav', 'srv-lp', 'cntr-lp-2', 'NORMAL', 'WAITING', ?)
    `).run(now);

    db.prepare(`
      INSERT INTO tokens (id, token_number, student_id, student_name, service_id, counter_id, priority, status, created_at)
      VALUES ('t-urg', 'LP-102', 'usr-student-ananya', 'Ananya', 'srv-lp', 'cntr-lp-2', 'URGENT', 'WAITING', ?)
    `).run(now);

    db.prepare(`
      INSERT INTO tokens (id, token_number, student_id, student_name, service_id, counter_id, priority, status, created_at)
      VALUES ('t-high', 'LP-103', 'usr-student-rohan', 'Rohan', 'srv-lp', 'cntr-lp-2', 'HIGH', 'WAITING', ?)
    `).run(now);

    const sorted = getSortedWaitingTokens('srv-lp');
    expect(sorted[0].id).toBe('t-urg');
    expect(sorted[1].id).toBe('t-high');
    expect(sorted[2].id).toBe('t-norm');
  });
});
