import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { seedDatabase } from '../db/seed.js';
import { getDb } from '../db/database.js';
import { queueEngine } from '../services/queueEngine.js';

describe('Issue #8: Implement Intelligent Multi-Counter Load Balancing', () => {
  beforeEach(() => {
    seedDatabase();
  });

  it('should exclude CLOSED and MAINTENANCE counters from load balancing allocation', () => {
    const db = getDb();
    // cntr-lp-1 is CLOSED, cntr-lp-2 is OPEN
    const bestCounter = queueEngine.getOptimalCounterForService('srv-lp');
    expect(bestCounter).not.toBeNull();
    expect(bestCounter?.counterId).toBe('cntr-lp-2');
  });

  it('should select the counter with lower workload when multiple counters are OPEN', () => {
    const db = getDb();
    // Open counter 1
    db.prepare(`UPDATE counters SET status = 'OPEN' WHERE id = 'cntr-lp-1'`).run();

    // cntr-lp-2 has active token LP-041 and waiting tokens LP-042, LP-043, LP-044
    // cntr-lp-1 has NO active or waiting tokens -> workload is 0
    const bestCounter = queueEngine.getOptimalCounterForService('srv-lp');
    expect(bestCounter).not.toBeNull();
    expect(bestCounter?.counterId).toBe('cntr-lp-1');
  });

  it('should deterministically tie-break equal workload counters', () => {
    const db = getDb();
    // Open counter 1
    db.prepare(`UPDATE counters SET status = 'OPEN' WHERE id = 'cntr-lp-1'`).run();
    // Clear all tokens so both counters have 0 workload
    db.prepare(`DELETE FROM tokens WHERE service_id = 'srv-lp'`).run();

    const bestCounter = queueEngine.getOptimalCounterForService('srv-lp');
    expect(bestCounter).not.toBeNull();
    // Deterministic tie-breaker selects Printer Counter 1
    expect(bestCounter?.counterId).toBe('cntr-lp-1');
  });

  it('should return null when all counters for a service are closed or under maintenance', () => {
    const db = getDb();
    db.prepare(`UPDATE counters SET status = 'CLOSED' WHERE service_id = 'srv-lp'`).run();

    const bestCounter = queueEngine.getOptimalCounterForService('srv-lp');
    expect(bestCounter).toBeNull();
  });

  it('should automatically assign optimal counter when student books without specifying counter_id', async () => {
    const db = getDb();
    // Open cntr-lp-1 as well (which has 0 queue)
    db.prepare(`UPDATE counters SET status = 'OPEN' WHERE id = 'cntr-lp-1'`).run();

    const studentRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'karan@queuecraft.edu', password: 'password123' });
    const studentToken = studentRes.body.token;

    // Book without counter_id
    const res = await request(app)
      .post('/api/student/tokens/book')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        service_id: 'srv-lp'
      });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    // Must be assigned to the less busy counter (cntr-lp-1)
    expect(res.body.token.counter_id).toBe('cntr-lp-1');
  });
});
