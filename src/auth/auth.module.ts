import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtGuard } from './guards/jwt.guard';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new Error(
      'JWT_SECRET must be set before starting the backend. Check backend/.env.',
    );
  }

  return secret;
}

@Module({
  imports: [
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtGuard],
  exports: [AuthService, JwtModule, JwtGuard],
})
export class AuthModule {}
