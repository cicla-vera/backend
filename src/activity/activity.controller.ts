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
import { ActivityService } from './activity.service';
import { CreateActivityEntryDto } from './dto/create-activity-entry.dto';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards(JwtGuard)
@Controller('activity')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Post()
  create(
    @CurrentUser() user: { sub: string },
    @Body() dto: CreateActivityEntryDto,
  ) {
    return this.activityService.create(user.sub, dto);
  }

  @Get()
  findAll(@CurrentUser() user: { sub: string }, @Query('date') date?: string) {
    if (date) {
      return this.activityService.findByDate(user.sub, date);
    }
    return this.activityService.findAll(user.sub);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.activityService.remove(user.sub, id);
  }
}
