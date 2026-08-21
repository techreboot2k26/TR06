import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { seedDatabase } from '../db/seed.js';
import { queueEngine } from '../services/queueEngine.js';
import { getDb } from '../db/database.js';

describe('Issue #2: Enforce Valid Token State Transitions', () => {
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
      .send({ email: 'aarav@queuecraft.edu', password: 'password123' });
    studentToken = studentRes.body.token;
  });

  describe('1. Valid State Transitions Lifecycle', () => {
    it('should follow valid lifecycle: WAITING -> SERVING -> COMPLETED', async () => {
      // In seed, LP-041 is currently SERVING at cntr-lp-2.
      // Complete LP-041
      const compRes = await request(app)
        .post('/api/staff/tokens/tkn-041/complete')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(compRes.status).toBe(200);
      expect(compRes.body.token.status).toBe('COMPLETED');

      // Next token in queue (LP-044) should move from WAITING -> SERVING
      const nextRes = await request(app)
        .post('/api/staff/counter/next')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(nextRes.status).toBe(200);
      expect(nextRes.body.token.status).toBe('SERVING');
    });

    it('should follow valid lifecycle: SERVING -> HELD -> SERVING', async () => {
      // Hold LP-041
      const holdRes = await request(app)
        .post('/api/staff/tokens/tkn-041/hold')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(holdRes.status).toBe(200);
      expect(holdRes.body.token.status).toBe('HELD');

      // Resume LP-041
      const resumeRes = await request(app)
        .post('/api/staff/tokens/tkn-041/resume')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.token.status).toBe('SERVING');
    });

    it('should follow valid lifecycle: WAITING -> CANCELLED by student', async () => {
      // tkn-042 is WAITING for Ananya on cntr-lp-2
      const ananyaRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'ananya@queuecraft.edu', password: 'password123' });
      const ananyaToken = ananyaRes.body.token;

      const cancelRes = await request(app)
        .patch('/api/student/tokens/tkn-042/cancel')
        .set('Authorization', `Bearer ${ananyaToken}`);
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.success).toBe(true);
    });

    it('should follow valid lifecycle: SERVING -> SKIPPED by staff', async () => {
      const skipRes = await request(app)
        .post('/api/staff/tokens/tkn-041/skip')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(skipRes.status).toBe(200);
      expect(skipRes.body.token.status).toBe('SKIPPED');
    });
  });

  describe('2. Invalid State Transitions (Must be Rejected)', () => {
    it('should reject COMPLETED -> SERVING (terminal state protection)', async () => {
      // tkn-039 is COMPLETED in seed
      const res = await request(app)
        .post('/api/staff/tokens/tkn-039/complete')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid state transition/i);
    });

    it('should reject COMPLETED -> HELD', async () => {
      const res = await request(app)
        .post('/api/staff/tokens/tkn-039/hold')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid state transition/i);
    });

    it('should reject COMPLETED -> SKIPPED', async () => {
      const res = await request(app)
        .post('/api/staff/tokens/tkn-039/skip')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid state transition/i);
    });

    it('should reject CANCELLED -> SERVING / CANCELLED -> HELD', async () => {
      const db = getDb();
      db.prepare(`UPDATE tokens SET status = 'CANCELLED' WHERE id = 'tkn-042'`).run();

      const resumeRes = await request(app)
        .post('/api/staff/tokens/tkn-042/resume')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(resumeRes.status).toBe(400);

      const holdRes = await request(app)
        .post('/api/staff/tokens/tkn-042/hold')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(holdRes.status).toBe(400);
    });

    it('should reject SKIPPED -> WAITING or SKIPPED -> SERVING', async () => {
      const db = getDb();
      db.prepare(`UPDATE tokens SET status = 'SKIPPED' WHERE id = 'tkn-042'`).run();

      const compRes = await request(app)
        .post('/api/staff/tokens/tkn-042/complete')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(compRes.status).toBe(400);
    });

    it('should reject completing a WAITING token without calling it to SERVING first', async () => {
      // tkn-042 is WAITING
      const res = await request(app)
        .post('/api/staff/tokens/tkn-042/complete')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid state transition/i);
    });

    it('should reject holding a WAITING token without calling it to SERVING first', async () => {
      const res = await request(app)
        .post('/api/staff/tokens/tkn-042/hold')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid state transition/i);
    });

    it('should reject resuming a WAITING or SERVING token (only HELD tokens can resume)', async () => {
      // tkn-041 is SERVING
      const res = await request(app)
        .post('/api/staff/tokens/tkn-041/resume')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid state transition/i);
    });

    it('should reject cancelling a COMPLETED or SKIPPED token by student', async () => {
      // tkn-039 is COMPLETED
      const nehaRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'neha@queuecraft.edu', password: 'password123' });
      const nehaToken = nehaRes.body.token;

      const res = await request(app)
        .patch('/api/student/tokens/tkn-039/cancel')
        .set('Authorization', `Bearer ${nehaToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cannot cancel token/i);
    });
  });
});
