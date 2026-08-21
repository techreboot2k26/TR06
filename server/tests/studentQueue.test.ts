import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { getDb, closeDb } from '../db/database.js';
import { seedDatabase } from '../db/seed.js';

describe('Student Experience & Token Management Integration Tests', () => {
  let studentToken: string;
  let studentWithActiveToken: string;
  let staffToken: string;

  beforeEach(async () => {
    seedDatabase();

    // Login as Demo Student (has no active token in seed)
    const studentRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@queuecraft.edu', password: 'password123' });
    studentToken = studentRes.body.token;

    // Login as Aarav Sharma (has active token LP-041 in seed)
    const aaravRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'aarav@queuecraft.edu', password: 'password123' });
    studentWithActiveToken = aaravRes.body.token;

    // Login as Staff
    const staffRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rudresh@queuecraft.edu', password: 'password123' });
    staffToken = staffRes.body.token;
  });

  afterAll(() => {
    closeDb();
  });

  describe('1. Authentication & RBAC Controls', () => {
    it('should allow student to access student services endpoint', async () => {
      const res = await request(app)
        .get('/api/student/services')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.services)).toBe(true);
      expect(res.body.services.length).toBeGreaterThan(0);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/student/services');
      expect(res.status).toBe(401);
    });

    it('should block staff user from accessing student endpoints', async () => {
      const res = await request(app)
        .get('/api/student/services')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('2. Service & Counter Discovery', () => {
    it('should return services along with their counters and queue metrics', async () => {
      const res = await request(app)
        .get('/api/student/services')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      const lpService = res.body.services.find((s: any) => s.code === 'LP');
      expect(lpService).toBeDefined();
      expect(lpService.counters.length).toBe(2);

      const counter2 = lpService.counters.find((c: any) => c.id === 'cntr-lp-2');
      expect(counter2).toBeDefined();
      expect(counter2.status).toBe('OPEN');
      expect(typeof counter2.queue_size).toBe('number');
      expect(typeof counter2.estimated_wait_time).toBe('number');
    });
  });

  describe('3. Active Token Management', () => {
    it('should return null active token for a student without one', async () => {
      const res = await request(app)
        .get('/api/student/tokens/active')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.token).toBeNull();
    });

    it('should return active token for student who currently has one', async () => {
      const res = await request(app)
        .get('/api/student/tokens/active')
        .set('Authorization', `Bearer ${studentWithActiveToken}`);

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.token.token_number).toBe('LP-041');
      expect(res.body.token.status).toBe('SERVING');
    });
  });

  describe('4. Token Booking Flow', () => {
    it('should successfully book a token for an open counter', async () => {
      const res = await request(app)
        .post('/api/student/tokens/book')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          service_id: 'srv-lp',
          counter_id: 'cntr-lp-2'
        });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.token.status).toBe('WAITING');
      expect(res.body.token.token_number).toMatch(/LP-/);
    });

    it('should reject booking when student already has an active token for the same service', async () => {
      const res = await request(app)
        .post('/api/student/tokens/book')
        .set('Authorization', `Bearer ${studentWithActiveToken}`)
        .send({
          service_id: 'srv-lp',
          counter_id: 'cntr-lp-2'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already have an active token/i);
    });

    it('should allow booking a DIFFERENT service when student has an active token in another service', async () => {
      // aarav has LP-041 SERVING on srv-lp. Booking srv-cnt should succeed.
      const res = await request(app)
        .post('/api/student/tokens/book')
        .set('Authorization', `Bearer ${studentWithActiveToken}`)
        .send({
          service_id: 'srv-cnt',
          counter_id: 'cntr-cnt-1'
        });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.token.service_id).toBe('srv-cnt');
      expect(res.body.token.status).toBe('WAITING');
    });

    it('should allow booking after previous token for same service is COMPLETED', async () => {
      // neha@queuecraft.edu has a COMPLETED token LP-039 on srv-lp (no active token)
      const nehaRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'neha@queuecraft.edu', password: 'password123' });
      const nehaToken = nehaRes.body.token;

      const res = await request(app)
        .post('/api/student/tokens/book')
        .set('Authorization', `Bearer ${nehaToken}`)
        .send({
          service_id: 'srv-lp',
          counter_id: 'cntr-lp-2'
        });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.token.status).toBe('WAITING');
    });

    it('should reject booking for a closed counter', async () => {
      const res = await request(app)
        .post('/api/student/tokens/book')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          service_id: 'srv-lp',
          counter_id: 'cntr-lp-1' // CLOSED in seed
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not accepting|not open|closed/i);
    });
  });

  describe('5. Token Cancellation Flow', () => {
    it('should successfully cancel a waiting token', async () => {
      // Login as Ananya (token LP-042 is WAITING)
      const ananyaRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'ananya@queuecraft.edu', password: 'password123' });
      const ananyaToken = ananyaRes.body.token;

      const res = await request(app)
        .patch('/api/student/tokens/tkn-042/cancel')
        .set('Authorization', `Bearer ${ananyaToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify token is now CANCELLED
      const db = getDb();
      const row = db.prepare('SELECT status FROM tokens WHERE id = ?').get('tkn-042') as any;
      expect(row.status).toBe('CANCELLED');
    });

    it('should prevent student from cancelling someone elses token', async () => {
      const res = await request(app)
        .patch('/api/student/tokens/tkn-042/cancel')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(404);
    });

    it('should reject cancelling a completed token', async () => {
      // Login as Neha (tkn-039 is COMPLETED)
      const nehaRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'neha@queuecraft.edu', password: 'password123' });
      const nehaToken = nehaRes.body.token;

      const res = await request(app)
        .patch('/api/student/tokens/tkn-039/cancel')
        .set('Authorization', `Bearer ${nehaToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cannot cancel/i);
    });
  });

  describe('6. Token History', () => {
    it('should return past tokens for student', async () => {
      // Login as Neha (has completed token in seed)
      const nehaRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'neha@queuecraft.edu', password: 'password123' });
      const nehaToken = nehaRes.body.token;

      const res = await request(app)
        .get('/api/student/tokens/history')
        .set('Authorization', `Bearer ${nehaToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.tokens)).toBe(true);
      expect(res.body.tokens.length).toBeGreaterThan(0);
      expect(res.body.tokens[0].token_number).toBe('LP-039');
      expect(res.body.tokens[0].status).toBe('COMPLETED');
    });
  });
});
