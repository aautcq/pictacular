import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import * as fs from 'fs';

async function bootstrap() {
  const httpsOptions =
    process.env.ENV === 'development'
      ? {
          key: fs.readFileSync('./server.key'),
          cert: fs.readFileSync('./server.crt')
        }
      : null;

  const app = await NestFactory.create(AppModule, {
    httpsOptions
  });

  app.use(helmet());

  app.enableCors({
    origin: process.env.CLIENT_URL,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type, Accept',
    credentials: true
  });

  app.use(cookieParser());

  app.useGlobalPipes(new ValidationPipe());

  app.getHttpAdapter().get('/', (req, res) => {
    res.status(200).send('Pictacular API is running - Adrien Autricque');
  });

  await app.listen(process.env.PORT, async () => {
    console.info(
      `Pictacular API is running on: ${process.env.API_URI}, port: ${process.env.PORT}`
    );
  });
}
bootstrap();
