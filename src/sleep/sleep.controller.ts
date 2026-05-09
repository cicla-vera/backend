import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CreateSleepEntryDto } from './dto/create-sleep-entry.dto';
import { SleepService } from './sleep.service';

@UseGuards(JwtGuard)
@Controller('sleep')
export class SleepController {
  constructor(private readonly sleepService: SleepService) {}

  @Post()
  create(
    @CurrentUser() user: { sub: string },
    @Body() dto: CreateSleepEntryDto,
  ) {
    return this.sleepService.create(user.sub, dto);
  }

  @Get()
  findAll(@CurrentUser() user: { sub: string }, @Query('date') date?: string) {
    if (date) {
      return this.sleepService.findByDate(user.sub, date);
    }

    return this.sleepService.findAll(user.sub);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.sleepService.remove(user.sub, id);
  }
}
