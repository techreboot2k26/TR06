import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { seedDatabase } from '../db/seed.js';
import { getDb } from '../db/database.js';

describe('Issue #7: Ensure Queue Operations Respect Counter Availability', () => {
  let staffToken: string;
  let studentToken: string;

  beforeEach(async () => {
    seedDatabase();

    const staffRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rudresh@queuecraft.edu', password: 'password123' });
    staffToken = staffRes.body.token;

    const studentRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'karan@queuecraft.edu', password: 'password123' });
    studentToken = studentRes.body.token;
  });

  it('should reject booking a token for a CLOSED counter', async () => {
    const res = await request(app)
      .post('/api/student/tokens/book')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        service_id: 'srv-lp',
        counter_id: 'cntr-lp-1' // cntr-lp-1 is CLOSED in seed
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/closed|not accepting/i);
  });

  it('should reject booking a token for a MAINTENANCE counter', async () => {
    const db = getDb();
    db.prepare(`UPDATE counters SET status = 'MAINTENANCE' WHERE id = 'cntr-lp-2'`).run();

    const res = await request(app)
      .post('/api/student/tokens/book')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        service_id: 'srv-lp',
        counter_id: 'cntr-lp-2'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maintenance|not accepting/i);
  });

  it('should reject CALL NEXT when counter is set to CLOSED or MAINTENANCE', async () => {
    const db = getDb();
    // Complete current serving token first so counter is free
    await request(app)
      .post('/api/staff/tokens/tkn-041/complete')
      .set('Authorization', `Bearer ${staffToken}`);

    // Set counter to CLOSED
    await request(app)
      .patch('/api/staff/counter/status')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'CLOSED' });

    // Attempt CALL NEXT
    const nextRes = await request(app)
      .post('/api/staff/counter/next')
      .set('Authorization', `Bearer ${staffToken}`);

    expect(nextRes.status).toBe(400);
    expect(nextRes.body.error).toMatch(/closed/i);
  });

  it('should preserve existing waiting and serving tokens when a counter goes into MAINTENANCE', async () => {
    const db = getDb();

    // Verify token LP-041 is currently SERVING on cntr-lp-2
    const tokenBefore = db.prepare(`SELECT * FROM tokens WHERE id = 'tkn-041'`).get() as any;
    expect(tokenBefore.status).toBe('SERVING');

    // Change counter status to MAINTENANCE
    await request(app)
      .patch('/api/staff/counter/status')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'MAINTENANCE' });

    // Verify token LP-041 is still intact in DB and not corrupted
    const tokenAfter = db.prepare(`SELECT * FROM tokens WHERE id = 'tkn-041'`).get() as any;
    expect(tokenAfter.status).toBe('SERVING');
    expect(tokenAfter.counter_id).toBe('cntr-lp-2');

    // Reopen counter
    await request(app)
      .patch('/api/staff/counter/status')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'OPEN' });

    // Complete token should now succeed normally
    const completeRes = await request(app)
      .post('/api/staff/tokens/tkn-041/complete')
      .set('Authorization', `Bearer ${staffToken}`);

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.token.status).toBe('COMPLETED');
  });
});
