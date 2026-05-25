import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { connect } from 'amqplib';

export const SAFETRADE_EXCHANGE = 'safetrade.events';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqService.name);
  private connection?: ChannelModel;
  private channel?: Channel;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('RABBITMQ_URL');
    if (!url) {
      this.logger.warn('RABBITMQ_URL not set; messaging is disabled');
      return;
    }
    const attempts = Math.max(
      1,
      Number(this.config.get('RABBITMQ_CONNECT_RETRIES') ?? 15) || 15,
    );
    const delayMs = Math.max(
      500,
      Number(this.config.get('RABBITMQ_CONNECT_DELAY_MS') ?? 2000) || 2000,
    );
    for (let i = 0; i < attempts; i++) {
      try {
        this.connection = await connect(url);
        this.channel = await this.connection.createChannel();
        await this.channel.assertExchange(SAFETRADE_EXCHANGE, 'topic', {
          durable: true,
        });
        this.logger.log('Connected to RabbitMQ');
        return;
      } catch (error) {
        await this.connection?.close().catch(() => undefined);
        this.connection = undefined;
        this.channel = undefined;
        this.logger.warn(
          `RabbitMQ connect attempt ${i + 1}/${attempts} failed: ${(error as Error).message}`,
        );
        if (i === attempts - 1) {
          this.logger.error(
            'Giving up on RabbitMQ for this process',
            error as Error,
          );
          return;
        }
        await sleep(delayMs);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  canPublishOrConsume(): boolean {
    return !!this.channel;
  }

  async publish(routingKey: string, payload: unknown): Promise<void> {
    if (!this.channel) {
      return;
    }
    this.channel.publish(
      SAFETRADE_EXCHANGE,
      routingKey,
      Buffer.from(JSON.stringify(payload)),
      { persistent: true, contentType: 'application/json' },
    );
  }

  async consume(
    queue: string,
    routingKeys: string[],
    handler: (routingKey: string, body: unknown) => Promise<void>,
  ): Promise<void> {
    if (!this.channel) {
      return;
    }
    await this.channel.assertQueue(queue, { durable: true });
    for (const key of routingKeys) {
      await this.channel.bindQueue(queue, SAFETRADE_EXCHANGE, key);
    }
    await this.channel.consume(queue, async (msg: ConsumeMessage | null) => {
      if (!msg || !this.channel) {
        return;
      }
      try {
        const body = JSON.parse(msg.content.toString()) as unknown;
        await handler(msg.fields.routingKey, body);
        this.channel.ack(msg);
      } catch (error) {
        this.logger.error('Consumer error', error as Error);
        this.channel.nack(msg, false, true);
      }
    });
  }
}
