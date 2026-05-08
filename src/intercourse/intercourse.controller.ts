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
import { CreateIntercourseEntryDto } from './dto/create-intercourse-entry.dto';
import { IntercourseService } from './intercourse.service';

@UseGuards(JwtGuard)
@Controller('intercourse')
export class IntercourseController {
  constructor(private readonly intercourseService: IntercourseService) {}

  @Post()
  create(
    @CurrentUser() user: { sub: string },
    @Body() dto: CreateIntercourseEntryDto,
  ) {
    return this.intercourseService.create(user.sub, dto);
  }

  @Get()
  findAll(@CurrentUser() user: { sub: string }, @Query('date') date?: string) {
    if (date) {
      return this.intercourseService.findByDate(user.sub, date);
    }

    return this.intercourseService.findAll(user.sub);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.intercourseService.remove(user.sub, id);
  }
}
