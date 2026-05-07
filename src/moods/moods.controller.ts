import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MoodsService } from './moods.service';
import { CreateMoodEntryDto } from './dto/create-mood-entry.dto';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards(JwtGuard)
@Controller('moods')
export class MoodsController {
  constructor(private readonly moodsService: MoodsService) {}

  @Post()
  create(
    @CurrentUser() user: { sub: string },
    @Body() dto: CreateMoodEntryDto,
  ) {
    return this.moodsService.create(user.sub, dto);
  }

  @Get()
  findAll(@CurrentUser() user: { sub: string }, @Query('date') date?: string) {
    if (date) {
      return this.moodsService.findByDate(user.sub, date);
    }
    return this.moodsService.findAll(user.sub);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.moodsService.remove(user.sub, id);
  }
}
