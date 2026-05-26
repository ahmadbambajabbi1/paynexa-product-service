import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RabbitmqModule } from './infrastructure/rabbitmq/rabbitmq.module';
import { ProductTypesModule } from './product-types/product-types.module';
import { ProductsModule } from './products/products.module';
import { ServiceMarketplaceModule } from './service-marketplace/service-marketplace.module';

import { RabbitmqRpcConsumer } from './infrastructure/rabbitmq/rabbitmq-rpc.consumer';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(process.cwd(), '.env'), join(__dirname, '..', '.env')],
    }),
    AuthModule,
    PrismaModule,
    RabbitmqModule,
    ProductTypesModule,
    ProductsModule,
    ServiceMarketplaceModule,
  ],
  controllers: [AppController],
  providers: [RabbitmqRpcConsumer],
})
export class AppModule {}
