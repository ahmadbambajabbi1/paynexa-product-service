import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { UserSessionService } from '../auth/user-session.service';

export type BookingCommentSocketPayload = {
  createdAt: string;
  authorUserId: string;
  authorName: string;
  authorRole: 'client' | 'provider' | 'participant';
  message: string;
};

@WebSocketGateway({
  namespace: '/booking',
  cors: { origin: true, credentials: true },
})
export class BookingRealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(BookingRealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: UserSessionService,
  ) {}

  async handleConnection(client: Socket) {
    const auth = client.handshake.auth as {
      token?: string;
      deviceId?: string;
    };
    let authorization: string | undefined;
    if (typeof auth?.token === 'string') {
      const t = auth.token.trim();
      authorization = t.startsWith('Bearer ') ? t : `Bearer ${t}`;
    }
    const deviceId =
      typeof auth?.deviceId === 'string' ? auth.deviceId.trim() : undefined;
    const user = await this.sessions.resolveUser(authorization, deviceId);
    if (!user) {
      this.logger.debug('booking socket: unauthorized handshake');
      client.disconnect(true);
      return;
    }
    client.data['userId'] = user.id;
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { bookingId?: string } | string,
  ) {
    const bookingId =
      typeof body === 'string'
        ? body.trim()
        : typeof body?.bookingId === 'string'
          ? body.bookingId.trim()
          : '';
    if (!bookingId) {
      return { ok: false as const, error: 'bookingId required' };
    }
    const userId = client.data['userId'] as string | undefined;
    if (!userId) {
      return { ok: false as const, error: 'unauthorized' };
    }
    const booking = await this.prisma.serviceBooking.findUnique({
      where: { id: bookingId },
      include: { listing: { include: { provider: true } } },
    });
    if (!booking) {
      return { ok: false as const, error: 'booking not found' };
    }
    const providerUserId = booking.listing.provider.userId;
    const allowed =
      booking.clientUserId === userId || providerUserId === userId;
    if (!allowed) {
      return { ok: false as const, error: 'forbidden' };
    }
    const room = `booking:${bookingId}`;
    await client.join(room);
    return { ok: true as const, room };
  }

  /** Broadcast updated comments to everyone subscribed to this booking (both parties). */
  emitBookingComments(
    bookingId: string,
    bookingComments: BookingCommentSocketPayload[],
  ) {
    this.server
      .to(`booking:${bookingId}`)
      .emit('booking:comments', { bookingId, bookingComments });
  }
}
