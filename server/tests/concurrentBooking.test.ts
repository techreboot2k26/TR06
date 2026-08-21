import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { seedDatabase } from '../db/seed.js';
import { getDb } from '../db/database.js';

describe('Issue #5: Make Token Booking Safe Under Concurrent Requests', () => {
  beforeEach(() => {
    seedDatabase();
  });

  it('should generate strictly unique token numbers when multiple students book concurrently', async () => {
    // Log in 5 students
    const studentEmails = [
      'aarav@queuecraft.edu',
      'ananya@queuecraft.edu',
      'rohan@queuecraft.edu',
      'diya@queuecraft.edu',
      'vikram@queuecraft.edu'
    ];

    // Clear any existing active tokens for these students to allow booking
    const db = getDb();
    db.prepare(`DELETE FROM tokens WHERE status IN ('WAITING', 'SERVING', 'HELD')`).run();

    const authTokens = await Promise.all(
      studentEmails.map(async (email) => {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ email, password: 'password123' });
        return res.body.token;
      })
    );

    // Book 5 tokens concurrently for srv-lp at cntr-lp-2
    const bookingResponses = await Promise.all(
      authTokens.map((authToken) =>
        request(app)
          .post('/api/student/tokens/book')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            service_id: 'srv-lp',
            counter_id: 'cntr-lp-2'
          })
      )
    );

    // All bookings must succeed
    bookingResponses.forEach((res) => {
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.token.token_number).toBeDefined();
    });

    // Extract all token numbers
    const tokenNumbers = bookingResponses.map((res) => res.body.token.token_number);
    const tokenIds = bookingResponses.map((res) => res.body.token.id);

    // Verify all token numbers are strictly unique (no duplicates)
    const uniqueTokenNumbers = new Set(tokenNumbers);
    expect(uniqueTokenNumbers.size).toBe(tokenNumbers.length);

    // Verify all token IDs are strictly unique
    const uniqueTokenIds = new Set(tokenIds);
    expect(uniqueTokenIds.size).toBe(tokenIds.length);
  });

  it('should reject concurrent duplicate booking attempts by the same student', async () => {
    const db = getDb();
    db.prepare(`DELETE FROM tokens WHERE status IN ('WAITING', 'SERVING', 'HELD')`).run();

    const studentRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'karan@queuecraft.edu', password: 'password123' });
    const studentToken = studentRes.body.token;

    // Send 3 simultaneous booking requests from the SAME student for srv-lp
    const responses = await Promise.all([
      request(app)
        .post('/api/student/tokens/book')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ service_id: 'srv-lp', counter_id: 'cntr-lp-2' }),
      request(app)
        .post('/api/student/tokens/book')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ service_id: 'srv-lp', counter_id: 'cntr-lp-2' }),
      request(app)
        .post('/api/student/tokens/book')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ service_id: 'srv-lp', counter_id: 'cntr-lp-2' })
    ]);

    const successCount = responses.filter((r) => r.status === 200).length;
    const errorCount = responses.filter((r) => r.status === 400).length;

    // Exactly 1 booking must succeed, and the other 2 must be rejected
    expect(successCount).toBe(1);
    expect(errorCount).toBe(2);

    // Verify exactly 1 active token exists in DB for this student on srv-lp
    const activeTokens = db.prepare(`
      SELECT * FROM tokens WHERE student_email = 'karan@queuecraft.edu' AND service_id = 'srv-lp' AND status = 'WAITING'
    `).all();
    expect(activeTokens.length).toBe(1);
  });
});
