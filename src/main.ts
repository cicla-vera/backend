import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

function parseCommaSeparatedList(value?: string) {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getCorsOrigin() {
  const configuredOrigins =
    process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN;

  if (!configuredOrigins) {
    return process.env.NODE_ENV === 'production' ? false : true;
  }

  if (configuredOrigins.trim() === '*') {
    return true;
  }

  return parseCommaSeparatedList(configuredOrigins);
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableCors({
    origin: getCorsOrigin(),
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

  const port = process.env.PORT ?? 3000;
  const host = process.env.HOST?.trim() || '0.0.0.0';

  await app.listen(port, host);
  console.log(`Application running on http://${host}:${port}`);
}

void bootstrap();
