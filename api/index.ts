import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { NestExpressApplication } from '@nestjs/platform-express';

let cachedApp: any;

async function bootstrap() {
  if (!cachedApp) {
    try {
      const app = await NestFactory.create<NestExpressApplication>(AppModule);
      
      app.enableCors({
        origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : true,
        credentials: true,
        methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Authorization', 'Content-Type'],
      });

      app.useBodyParser('text', {
        type: ['application/xml', 'text/xml', 'text/plain'],
        limit: '25mb',
      });

      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );

      app.setGlobalPrefix('api');
      
      await app.init();
      cachedApp = app.getHttpAdapter().getInstance();
    } catch (err) {
      console.error('Error during bootstrap:', err);
      throw err;
    }
  }
  return cachedApp;
}

export default async (req: any, res: any) => {
  try {
    const app = await bootstrap();
    return app(req, res);
  } catch (err) {
    console.error('Execution error:', err);
    res.status(500).send('Internal Server Error during bootstrap');
  }
};
