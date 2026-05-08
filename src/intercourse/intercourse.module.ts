import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntercourseController } from './intercourse.controller';
import { IntercourseService } from './intercourse.service';

@Module({
  imports: [AuthModule],
  controllers: [IntercourseController],
  providers: [IntercourseService],
})
export class IntercourseModule {}
