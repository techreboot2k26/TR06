import { Server as SocketIOServer } from 'socket.io';

export class SocketService {
  private io: SocketIOServer | null = null;

  public init(io: SocketIOServer): void {
    this.io = io;

    this.io.on('connection', (socket) => {
      console.log(`[Socket.IO] Client connected: ${socket.id}`);

      socket.on('join_counter', (counterId: string) => {
        socket.join(`counter:${counterId}`);
        console.log(`[Socket.IO] Client ${socket.id} joined room counter:${counterId}`);
      });

      socket.on('join_service', (serviceId: string) => {
        socket.join(`service:${serviceId}`);
        console.log(`[Socket.IO] Client ${socket.id} joined room service:${serviceId}`);
      });

      socket.on('disconnect', () => {
        console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
      });
    });
  }

  /**
   * Broadcast real-time queue change event to all clients or specific rooms
   */
  public emitQueueUpdated(serviceId: string, payload: any): void {
    if (!this.io) return;
    this.io.emit('QUEUE_UPDATED', payload);
    this.io.to(`service:${serviceId}`).emit('QUEUE_UPDATED', payload);
  }

  public emitTokenCalled(counterId: string, token: any): void {
    if (!this.io) return;
    this.io.emit('TOKEN_CALLED', { counterId, token });
    this.io.to(`counter:${counterId}`).emit('TOKEN_CALLED', token);
  }

  public emitTokenCompleted(counterId: string, token: any): void {
    if (!this.io) return;
    this.io.emit('TOKEN_COMPLETED', { counterId, token });
    this.io.to(`counter:${counterId}`).emit('TOKEN_COMPLETED', token);
  }

  public emitTokenSkipped(counterId: string, token: any): void {
    if (!this.io) return;
    this.io.emit('TOKEN_SKIPPED', { counterId, token });
    this.io.to(`counter:${counterId}`).emit('TOKEN_SKIPPED', token);
  }

  public emitTokenHeld(counterId: string, token: any): void {
    if (!this.io) return;
    this.io.emit('TOKEN_HELD', { counterId, token });
    this.io.to(`counter:${counterId}`).emit('TOKEN_HELD', token);
  }

  public emitTokenResumed(counterId: string, token: any): void {
    if (!this.io) return;
    this.io.emit('TOKEN_RESUMED', { counterId, token });
    this.io.to(`counter:${counterId}`).emit('TOKEN_RESUMED', token);
  }

  public emitCounterStatusChanged(counterId: string, status: string): void {
    if (!this.io) return;
    this.io.emit('COUNTER_STATUS_CHANGED', { counterId, status });
  }

  /**
   * Emit TOKEN_CANCELLED event so the student UI can immediately reflect cancellation (#6)
   */
  public emitTokenCancelled(serviceId: string, counterId: string, tokenId: string): void {
    if (!this.io) return;
    const payload = { tokenId, counterId, serviceId };
    // Broadcast globally and to the service room
    this.io.emit('TOKEN_CANCELLED', payload);
    this.io.to(`service:${serviceId}`).emit('TOKEN_CANCELLED', payload);
    this.io.to(`counter:${counterId}`).emit('TOKEN_CANCELLED', payload);
  }
}

export const socketService = new SocketService();
