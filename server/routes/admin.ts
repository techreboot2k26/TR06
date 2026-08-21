import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/database.js';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth.js';
import { socketService } from '../services/socketService.js';

const router = Router();

// Replicate pbkdf2 password hashing helper Sync to match seed.ts
function hashPassword(password: string): string {
  const salt = 'queuecraft_salt_2026';
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

// Apply authentication and ADMIN check constraint middleware to all endpoints
router.use(authenticateToken);
router.use(requireRole(['ADMIN']));

// Helper to generate UUIDs if needed, or we can use crypto.randomUUID()
function generateId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

// 1. GET /api/admin/dashboard
router.get('/dashboard', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    
    // Services Count
    const servicesCount = (db.prepare('SELECT COUNT(*) as cnt FROM services').get() as any).cnt;
    
    // Active Counters
    const activeCounters = (db.prepare("SELECT COUNT(*) as cnt FROM counters WHERE status != 'CLOSED'").get() as any).cnt;
    
    // Waiting Tokens
    const waitingTokens = (db.prepare("SELECT COUNT(*) as cnt FROM tokens WHERE status = 'WAITING'").get() as any).cnt;
    
    // Serving Tokens
    const servingTokens = (db.prepare("SELECT COUNT(*) as cnt FROM tokens WHERE status = 'SERVING'").get() as any).cnt;
    
    // Completed Today Count
    const completedToday = (db.prepare(`
      SELECT COUNT(*) as cnt FROM tokens 
      WHERE status = 'COMPLETED' AND date(completed_at) = date('now')
    `).get() as any).cnt;

    // Skipped Today Count
    const skippedToday = (db.prepare(`
      SELECT COUNT(*) as cnt FROM tokens 
      WHERE status = 'SKIPPED' AND date(skipped_at) = date('now')
    `).get() as any).cnt;

    // Cancelled/Skipped Today Count
    const cancelledCount = (db.prepare(`
      SELECT COUNT(*) as cnt FROM tokens 
      WHERE status = 'CANCELLED' AND date(created_at) = date('now')
    `).get() as any).cnt;

    // Average waiting time calculation (in minutes) for all tokens ever checked-in
    const avgWaitResult = db.prepare(`
      SELECT AVG((julianday(started_at) - julianday(created_at)) * 24 * 60) as avg_mins 
      FROM tokens 
      WHERE started_at IS NOT NULL
    `).get() as any;
    
    const avgWaitingTime = avgWaitResult?.avg_mins ? Math.round(avgWaitResult.avg_mins * 10) / 10 : 0;

    res.json({
      services_count: servicesCount,
      active_counters_count: activeCounters,
      waiting_tokens_count: waitingTokens,
      currently_serving_count: servingTokens,
      completed_today_count: completedToday,
      skipped_today_count: skippedToday,
      cancelled_today_count: cancelledCount,
      avg_waiting_time_minutes: avgWaitingTime
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Database error occurred' });
  }
});

// 2. USER/STAFF OPERATIONS CRUD (/api/admin/users)
// GET all users
router.get('/users', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const users = db.prepare('SELECT id, name, email, role, created_at FROM users').all();
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to list users' });
  }
});

// POST create user
router.post('/users', (req: AuthRequest, res: Response) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      res.status(400).json({ error: 'Name, email, password, and role are required' });
      return;
    }

    if (!['STUDENT', 'STAFF', 'ADMIN'].includes(role)) {
      res.status(400).json({ error: 'Invalid user role' });
      return;
    }

    const db = getDb();
    // Check if email already exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      res.status(400).json({ error: 'A user with this email already exists' });
      return;
    }

    const newId = generateId('usr');
    const passwordHash = hashPassword(password);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO users (id, name, email, password_hash, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(newId, name, email, passwordHash, role, now);

    res.status(210).json({
      id: newId,
      name,
      email,
      role,
      created_at: now
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create user' });
  }
});

// PATCH edit user
router.patch('/users/:id', (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, email, password, role } = req.body;
    const db = getDb();

    // Verify user exists first
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Email unique check
    if (email && email !== user.email) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) {
        res.status(400).json({ error: 'A user with this email already exists' });
        return;
      }
    }

    const updatedName = name !== undefined ? name : user.name;
    const updatedEmail = email !== undefined ? email : user.email;
    const updatedRole = role !== undefined ? role : user.role;
    let updatedHash = user.password_hash;
    
    if (password) {
      updatedHash = hashPassword(password);
    }

    if (role && !['STUDENT', 'STAFF', 'ADMIN'].includes(role)) {
      res.status(400).json({ error: 'Invalid user role' });
      return;
    }

    db.prepare(`
      UPDATE users 
      SET name = ?, email = ?, password_hash = ?, role = ?
      WHERE id = ?
    `).run(updatedName, updatedEmail, updatedHash, updatedRole, id);

    res.json({
      id,
      name: updatedName,
      email: updatedEmail,
      role: updatedRole,
      created_at: user.created_at
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update user' });
  }
});

// DELETE user
router.delete('/users/:id', (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const db = getDb();

    // Verify user exists
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as any;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Prevent deleting oneself
    if (id === req.user?.id) {
      res.status(400).json({ error: 'Cannot delete your own logged-in administrator account' });
      return;
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete user' });
  }
});


// 3. SERVICE CONFIGURATION CRUD (/api/admin/services)
// GET all services
router.get('/services', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const services = db.prepare('SELECT * FROM services ORDER BY name ASC').all();
    res.json(services);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to list services' });
  }
});

// POST create service
router.post('/services', (req: AuthRequest, res: Response) => {
  try {
    const { name, code, description } = req.body;
    if (!name || !code) {
      res.status(400).json({ error: 'Service name and code are required' });
      return;
    }

    const cleanCode = code.trim().toUpperCase();
    const db = getDb();

    // Validations: Shortcode should be unique
    const existingCode = db.prepare('SELECT id FROM services WHERE code = ?').get(cleanCode);
    if (existingCode) {
      res.status(400).json({ error: `Service shortcode '${cleanCode}' is already taken` });
      return;
    }

    const newId = generateId('srv');
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO services (id, name, code, description, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(newId, name, cleanCode, description || '', now);

    socketService.emitQueueUpdated(newId, { action: 'SERVICE_CREATED', serviceId: newId });

    res.status(210).json({
      id: newId,
      name,
      code: cleanCode,
      description: description || '',
      created_at: now
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create service' });
  }
});

// PATCH edit service
router.patch('/services/:id', (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, code, description } = req.body;
    const db = getDb();

    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(id) as any;
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    const cleanCode = code ? code.trim().toUpperCase() : service.code;

    if (code && cleanCode !== service.code) {
      const existingCode = db.prepare('SELECT id FROM services WHERE code = ?').get(cleanCode);
      if (existingCode) {
        res.status(400).json({ error: `Service shortcode '${cleanCode}' is already taken` });
        return;
      }
    }

    const updatedName = name !== undefined ? name : service.name;
    const updatedDesc = description !== undefined ? description : service.description;

    db.prepare(`
      UPDATE services 
      SET name = ?, code = ?, description = ?
      WHERE id = ?
    `).run(updatedName, cleanCode, updatedDesc, id);

    socketService.emitQueueUpdated(id, { action: 'SERVICE_UPDATED', serviceId: id });

    res.json({
      id,
      name: updatedName,
      code: cleanCode,
      description: updatedDesc,
      created_at: service.created_at
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update service' });
  }
});

// DELETE service
router.delete('/services/:id', (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const db = getDb();

    const service = db.prepare('SELECT id FROM services WHERE id = ?').get(id);
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    // Prevent deletion if there are active counters or tokens linked to this service
    const linkedCountersCount = (db.prepare('SELECT COUNT(*) as cnt FROM counters WHERE service_id = ?').get(id) as any).cnt;
    if (linkedCountersCount > 0) {
      res.status(400).json({ error: `Cannot delete service: There are ${linkedCountersCount} counters assigned to it.` });
      return;
    }

    const linkedTokensCount = (db.prepare("SELECT COUNT(*) as cnt FROM tokens WHERE service_id = ? AND status IN ('WAITING', 'SERVING', 'HELD')").get(id) as any).cnt;
    if (linkedTokensCount > 0) {
      res.status(400).json({ error: `Cannot delete service: There are ${linkedTokensCount} active tokens currently in queue.` });
      return;
    }

    db.prepare('DELETE FROM services WHERE id = ?').run(id);
    socketService.emitQueueUpdated(id, { action: 'SERVICE_DELETED', serviceId: id });

    res.json({ success: true, message: 'Service deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete service' });
  }
});


// 4. COUNTER CONFIGURATION CRUD (/api/admin/counters)
// GET all counters
router.get('/counters', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const counters = db.prepare(`
      SELECT c.*, s.name as service_name, s.code as service_code, u.name as assigned_staff_name
      FROM counters c
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN users u ON c.assigned_staff_id = u.id
      ORDER BY c.name ASC
    `).all();
    res.json(counters);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to list counters' });
  }
});

// POST create counter
router.post('/counters', (req: AuthRequest, res: Response) => {
  try {
    const { name, service_id, status } = req.body;
    if (!name || !service_id) {
      res.status(400).json({ error: 'Counter name and service ID are required' });
      return;
    }

    const db = getDb();
    // Validate service exists
    const service = db.prepare('SELECT id FROM services WHERE id = ?').get(service_id);
    if (!service) {
      res.status(400).json({ error: 'Selected service does not exist' });
      return;
    }

    const newId = generateId('cntr');
    const cleanStatus = status || 'CLOSED';
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO counters (id, service_id, name, status, assigned_staff_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(newId, service_id, name, cleanStatus, null, now);

    socketService.emitCounterStatusChanged(newId, cleanStatus);
    socketService.emitQueueUpdated(service_id, { action: 'COUNTER_CREATED', counterId: newId });

    res.status(210).json({
      id: newId,
      name,
      service_id,
      status: cleanStatus,
      assigned_staff_id: null,
      created_at: now
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create counter' });
  }
});

// PATCH update counter
router.patch('/counters/:id', (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, service_id, status } = req.body;
    const db = getDb();

    const counter = db.prepare('SELECT * FROM counters WHERE id = ?').get(id) as any;
    if (!counter) {
      res.status(404).json({ error: 'Counter not found' });
      return;
    }

    if (service_id && service_id !== counter.service_id) {
      // Validate service exists
      const service = db.prepare('SELECT id FROM services WHERE id = ?').get(service_id);
      if (!service) {
        res.status(400).json({ error: 'Selected service does not exist' });
        return;
      }
    }

    if (status && !['OPEN', 'CLOSED', 'BUSY', 'MAINTENANCE'].includes(status)) {
      res.status(400).json({ error: 'Invalid counter status' });
      return;
    }

    const updatedName = name !== undefined ? name : counter.name;
    const updatedServiceId = String(service_id !== undefined ? service_id : counter.service_id);
    const updatedStatus = status !== undefined ? status : counter.status;

    db.prepare(`
      UPDATE counters 
      SET name = ?, service_id = ?, status = ?
      WHERE id = ?
    `).run(updatedName, updatedServiceId, updatedStatus, id);

    socketService.emitCounterStatusChanged(id, updatedStatus);
    socketService.emitQueueUpdated(updatedServiceId, { action: 'COUNTER_STATUS', status: updatedStatus, counterId: id });

    res.json({
      id,
      name: updatedName,
      service_id: updatedServiceId,
      status: updatedStatus,
      assigned_staff_id: counter.assigned_staff_id,
      created_at: counter.created_at
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update counter' });
  }
});

// DELETE counter
router.delete('/counters/:id', (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const db = getDb();

    const counter = db.prepare('SELECT * FROM counters WHERE id = ?').get(id) as any;
    if (!counter) {
      res.status(404).json({ error: 'Counter not found' });
      return;
    }

    // Prevent deletion if active tokens are tied to this counter
    const activeTokens = (db.prepare("SELECT COUNT(*) as cnt FROM tokens WHERE counter_id = ? AND status = 'SERVING'").get(id) as any).cnt;
    if (activeTokens > 0) {
      res.status(400).json({ error: 'Cannot delete counter: An active token is currently being processed on it.' });
      return;
    }

    db.prepare('DELETE FROM counters WHERE id = ?').run(id);
    socketService.emitQueueUpdated(String(counter.service_id), { action: 'COUNTER_DELETED', counterId: id });

    res.json({ success: true, message: 'Counter deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete counter' });
  }
});

// PATCH /api/admin/counters/:id/assign-staff
router.patch('/counters/:id/assign-staff', (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const { staffId } = req.body; // Can be string or null
    const db = getDb();

    const counter = db.prepare('SELECT * FROM counters WHERE id = ?').get(id) as any;
    if (!counter) {
      res.status(404).json({ error: 'Counter not found' });
      return;
    }

    const targetStaffId = staffId && typeof staffId === 'string' && staffId.trim() !== '' ? staffId.trim() : null;

    if (targetStaffId !== null) {
      // Validate staff exists and is indeed staff
      const staffUser = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'STAFF'").get(targetStaffId) as any;
      if (!staffUser) {
        res.status(400).json({ error: 'User does not exist or does not possess the STAFF role' });
        return;
      }

      // Enforce exclusivity: check if they are already assigned elsewhere
      const existingAssignment = db.prepare(`
        SELECT * FROM counters WHERE assigned_staff_id = ? AND id != ?
      `).get(targetStaffId, id) as any;

      // Handle re-assignment: clear the other counter assignments if found
      if (existingAssignment) {
        db.prepare('UPDATE counters SET assigned_staff_id = NULL WHERE id = ?').run(existingAssignment.id);
        socketService.emitQueueUpdated(existingAssignment.service_id, {
          action: 'STAFF_UNASSIGNED',
          counterId: existingAssignment.id
        });
      }
    }

    // Run update transaction
    db.prepare('UPDATE counters SET assigned_staff_id = ? WHERE id = ?').run(targetStaffId, id);

    socketService.emitQueueUpdated(counter.service_id, {
      action: targetStaffId ? 'STAFF_ASSIGNED' : 'STAFF_UNASSIGNED',
      counterId: id,
      assignedStaffId: targetStaffId
    });

    res.json({
      success: true,
      message: targetStaffId ? 'Staff operator assigned successfully' : 'Staff operator unassigned successfully',
      counter_id: id,
      assigned_staff_id: targetStaffId
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to assign staff' });
  }
});


// 5. GET /api/admin/live-monitor
router.get('/live-monitor', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();

    // Query active state configuration
    const liveCounters = db.prepare(`
      SELECT c.id as counter_id, c.name as counter_name, c.status as counter_status,
             s.id as service_id, s.name as service_name, s.code as service_code,
             u.id as staff_id, u.name as staff_name
      FROM counters c
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN users u ON c.assigned_staff_id = u.id
      ORDER BY c.name ASC
    `).all() as any[];

    const liveData = liveCounters.map((c) => {
      // Find active serving token
      const servingToken = db.prepare(`
        SELECT id, token_number, student_name, started_at
        FROM tokens
        WHERE counter_id = ? AND status = 'SERVING'
        LIMIT 1
      `).get(c.counter_id) as any;

      // Fetch queue size count
      const queueCount = (db.prepare(`
        SELECT COUNT(*) as cnt FROM tokens
        WHERE service_id = ? AND status = 'WAITING'
      `).get(c.service_id) as any).cnt;

      return {
        counter_id: c.counter_id,
        counter_name: c.counter_name,
        counter_status: c.counter_status,
        service_id: c.service_id,
        service_name: c.service_name,
        service_code: c.service_code,
        assigned_staff: c.staff_name ? { id: c.staff_id, name: c.staff_name } : null,
        current_token: servingToken ? {
          id: servingToken.id,
          token_number: servingToken.token_number,
          student_name: servingToken.student_name,
          started_at: servingToken.started_at
        } : null,
        waiting_count: queueCount
      };
    });

    res.json(liveData);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load live monitor' });
  }
});


// 6. GET /api/admin/analytics
router.get('/analytics', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();

    // Standard counts
    const totalCreated = (db.prepare('SELECT COUNT(*) as cnt FROM tokens').get() as any).cnt;
    const completedCount = (db.prepare("SELECT COUNT(*) as cnt FROM tokens WHERE status = 'COMPLETED'").get() as any).cnt;
    const skippedCount = (db.prepare("SELECT COUNT(*) as cnt FROM tokens WHERE status = 'SKIPPED'").get() as any).cnt;
    const cancelledCount = (db.prepare("SELECT COUNT(*) as cnt FROM tokens WHERE status = 'CANCELLED'").get() as any).cnt;
    const heldCount = (db.prepare("SELECT COUNT(*) as cnt FROM tokens WHERE status = 'HELD'").get() as any).cnt;
    const waitingCount = (db.prepare("SELECT COUNT(*) as cnt FROM tokens WHERE status = 'WAITING'").get() as any).cnt;

    // Service duration averages
    const avgServiceResult = db.prepare(`
      SELECT AVG((julianday(completed_at) - julianday(started_at)) * 24 * 60) as avg_mins
      FROM tokens
      WHERE status = 'COMPLETED' AND started_at IS NOT NULL AND completed_at IS NOT NULL
    `).get() as any;
    const avgServiceDuration = avgServiceResult?.avg_mins ? Math.round(avgServiceResult.avg_mins * 10) / 10 : 0;

    // Waiting duration averages
    const avgWaitResult = db.prepare(`
      SELECT AVG((julianday(started_at) - julianday(created_at)) * 24 * 60) as avg_mins
      FROM tokens
      WHERE started_at IS NOT NULL
    `).get() as any;
    const avgWaitingTime = avgWaitResult?.avg_mins ? Math.round(avgWaitResult.avg_mins * 10) / 10 : 0;

    // Service Distribution loading
    const serviceDistribution = db.prepare(`
      SELECT s.id, s.name as label, s.code, COUNT(t.id) as value
      FROM services s
      LEFT JOIN tokens t ON s.id = t.service_id
      GROUP BY s.id
    `).all() as any[];

    // Counter Activity distribution
    const counterActivity = db.prepare(`
      SELECT c.id, c.name as label, COUNT(t.id) as value
      FROM counters c
      LEFT JOIN tokens t ON c.id = t.counter_id AND t.status = 'COMPLETED'
      GROUP BY c.id
    `).all() as any[];

    // Token creation hourly distribution over time (if timestamps populate correctly)
    // Grouping by time blocks using SQLite strftime
    const hourlyDistribution = db.prepare(`
      SELECT strftime('%H:00', created_at) as hour, COUNT(*) as count
      FROM tokens
      WHERE created_at IS NOT NULL
      GROUP BY hour
      ORDER BY hour ASC
    `).all() as any[];

    res.json({
      summary: {
        total_created: totalCreated,
        completed_count: completedCount,
        skipped_count: skippedCount,
        cancelled_count: cancelledCount,
        held_count: heldCount,
        waiting_count: waitingCount,
        avg_service_minutes: avgServiceDuration,
        avg_waiting_minutes: avgWaitingTime
      },
      service_distribution: serviceDistribution,
      counter_activity: counterActivity,
      hourly_distribution: hourlyDistribution
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate analytics' });
  }
});

export default router;
