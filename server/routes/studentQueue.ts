import { Router, Response } from 'express';
import { AuthRequest, authenticateToken, requireRole } from '../middleware/auth.js';
import { getDb } from '../db/database.js';
import { socketService } from '../services/socketService.js';
import crypto from 'crypto';

const router = Router();

// Apply auth middleware to all student routes
router.use(authenticateToken);
router.use(requireRole(['STUDENT']));

/**
 * 1. GET /api/student/services
 * Get all services and their active counters
 */
router.get('/services', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const services = db.prepare('SELECT id, name, code, description FROM services').all() as any[];
    const counters = db.prepare('SELECT id, service_id, name, status FROM counters').all() as any[];

    // Calculate queue size for each counter
    const queueSizes = db.prepare(`
      SELECT counter_id, COUNT(*) as count 
      FROM tokens 
      WHERE status IN ('WAITING', 'HELD') AND counter_id IS NOT NULL
      GROUP BY counter_id
    `).all() as { counter_id: string; count: number }[];

    const servicesWithCounters = services.map(service => ({
      ...service,
      counters: counters
        .filter(c => c.service_id === service.id)
        .map(c => {
          const queueSize = queueSizes.find(q => q.counter_id === c.id)?.count || 0;
          return {
            ...c,
            queue_size: queueSize,
            estimated_wait_time: queueSize * 5 // Rough estimate: 5 mins per person
          };
        })
    }));

    res.json({ services: servicesWithCounters });
  } catch (err) {
    console.error('Error fetching services:', err);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

/**
 * 2. POST /api/student/tokens/book
 * Book a new token for a specific service and counter
 */
router.post('/tokens/book', (req: AuthRequest, res: Response) => {
  const { service_id, counter_id } = req.body;
  const user = req.user!;

  if (!service_id || !counter_id) {
    res.status(400).json({ error: 'Service ID and Counter ID are required' });
    return;
  }

  try {
    const db = getDb();

    let bookingError: string | null = null;
    let createdTokenId: string | null = null;

    // Wrap check + insert in a transaction to prevent race conditions
    const bookTransaction = db.transaction(() => {
      // Check if the student already has an active token for THIS specific service (#1)
      const activeToken = db.prepare(`
        SELECT id, token_number FROM tokens 
        WHERE student_id = ? AND service_id = ? AND status IN ('WAITING', 'SERVING', 'HELD')
      `).get(user.id, service_id) as any;

      if (activeToken) {
        bookingError = `You already have an active token (${activeToken.token_number}) for this service. Complete or cancel it first.`;
        return;
      }

      // Get service code
      const service = db.prepare('SELECT code FROM services WHERE id = ?').get(service_id) as any;
      if (!service) {
        bookingError = 'Service not found';
        return;
      }

      // Get counter and validate it belongs to the service
      const counter = db.prepare('SELECT id, status FROM counters WHERE id = ? AND service_id = ?').get(counter_id, service_id) as any;
      if (!counter) {
        bookingError = 'Counter not found for this service';
        return;
      }

      if (counter.status === 'CLOSED' || counter.status === 'MAINTENANCE') {
        bookingError = 'Counter is currently not accepting new tokens';
        return;
      }

      // Generate Token Number (e.g., LP-042)
      const sequenceQuery = db.prepare(`
        SELECT COUNT(*) as count 
        FROM tokens 
        WHERE service_id = ? AND date(created_at) = date('now')
      `).get(service_id) as any;

      const seqNum = (sequenceQuery.count + 1).toString().padStart(3, '0');
      const tokenNumber = `${service.code}-${seqNum}`;
      const tokenId = crypto.randomUUID();

      db.prepare(`
        INSERT INTO tokens (id, token_number, student_id, student_name, student_email, service_id, counter_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'WAITING')
      `).run(tokenId, tokenNumber, user.id, user.name, user.email, service_id, counter_id);

      createdTokenId = tokenId;
    });

    bookTransaction();

    if (bookingError) {
      const statusCode = bookingError.includes('already have an active token') ? 400
        : bookingError.includes('not found') ? 404
        : 400;
      res.status(statusCode).json({ error: bookingError });
      return;
    }

    // Notify staff and other students
    socketService.emitQueueUpdated(service_id, { counterId: counter_id });

    // Fetch the inserted token details
    const token = db.prepare(`
      SELECT t.*, s.name as service_name, c.name as counter_name
      FROM tokens t
      JOIN services s ON t.service_id = s.id
      JOIN counters c ON t.counter_id = c.id
      WHERE t.id = ?
    `).get(createdTokenId);

    res.json({ token });
  } catch (err) {
    console.error('Error booking token:', err);
    res.status(500).json({ error: 'Failed to book token' });
  }
});

/**
 * 3. GET /api/student/tokens/active
 * Get the student's current active token (WAITING, SERVING, HELD)
 */
router.get('/tokens/active', (req: AuthRequest, res: Response) => {
  const user = req.user!;

  try {
    const db = getDb();
    const token = db.prepare(`
      SELECT t.*, s.name as service_name, c.name as counter_name
      FROM tokens t
      JOIN services s ON t.service_id = s.id
      JOIN counters c ON t.counter_id = c.id
      WHERE t.student_id = ? AND t.status IN ('WAITING', 'SERVING', 'HELD')
      ORDER BY t.created_at DESC
      LIMIT 1
    `).get(user.id) as any;

    if (!token) {
      res.json({ token: null });
      return;
    }

    let peopleAhead = 0;
    if (token.status === 'WAITING' || token.status === 'HELD') {
       const aheadQuery = db.prepare(`
         SELECT COUNT(*) as count 
         FROM tokens 
         WHERE counter_id = ? AND status IN ('WAITING', 'HELD') AND created_at < ?
       `).get(token.counter_id, token.created_at) as any;
       peopleAhead = aheadQuery.count;
    }

    res.json({ 
      token: {
        ...token,
        people_ahead: peopleAhead,
        estimated_wait_time: peopleAhead * 5
      } 
    });
  } catch (err) {
    console.error('Error fetching active token:', err);
    res.status(500).json({ error: 'Failed to fetch active token' });
  }
});

/**
 * 4. GET /api/student/tokens/history
 * Get the student's past tokens (COMPLETED, CANCELLED, SKIPPED)
 */
router.get('/tokens/history', (req: AuthRequest, res: Response) => {
  const user = req.user!;

  try {
    const db = getDb();
    const tokens = db.prepare(`
      SELECT t.*, s.name as service_name, c.name as counter_name
      FROM tokens t
      JOIN services s ON t.service_id = s.id
      JOIN counters c ON t.counter_id = c.id
      WHERE t.student_id = ? AND t.status IN ('COMPLETED', 'CANCELLED', 'SKIPPED')
      ORDER BY t.created_at DESC
    `).all(user.id);

    res.json({ tokens });
  } catch (err) {
    console.error('Error fetching token history:', err);
    res.status(500).json({ error: 'Failed to fetch token history' });
  }
});

/**
 * 5. PATCH /api/student/tokens/:tokenId/cancel
 * Allow a student to cancel their waiting token
 */
router.patch('/tokens/:tokenId/cancel', (req: AuthRequest, res: Response) => {
  const { tokenId } = req.params;
  const user = req.user!;

  try {
    const db = getDb();
    
    const token = db.prepare(`
      SELECT id, status, counter_id, service_id FROM tokens WHERE id = ? AND student_id = ?
    `).get(tokenId, user.id) as any;

    if (!token) {
      res.status(404).json({ error: 'Token not found' });
      return;
    }

    if (token.status !== 'WAITING' && token.status !== 'HELD') {
      res.status(400).json({ error: `Cannot cancel token with status: ${token.status}` });
      return;
    }

    db.prepare(`
      UPDATE tokens 
      SET status = 'CANCELLED', completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(tokenId);

    if (token.counter_id && token.service_id) {
       socketService.emitQueueUpdated(token.service_id, { counterId: token.counter_id });
    }

    res.json({ success: true, message: 'Token cancelled successfully' });
  } catch (err) {
    console.error('Error cancelling token:', err);
    res.status(500).json({ error: 'Failed to cancel token' });
  }
});

export default router;
