import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CreateSafetyLocationDto } from './dto/create-safety-location.dto';
import { UpdateSafetyLocationDto } from './dto/update-safety-location.dto';
import { SafetyLocationsService } from './safety-locations.service';

@UseGuards(JwtGuard)
@Controller('vera/safety-locations')
export class SafetyLocationsController {
  constructor(
    private readonly safetyLocationsService: SafetyLocationsService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: { sub: string },
    @Body() dto: CreateSafetyLocationDto,
  ) {
    return this.safetyLocationsService.create(user.sub, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: { sub: string },
    @Query('includeDisabled') includeDisabled?: string,
  ) {
    return this.safetyLocationsService.findAll(
      user.sub,
      includeDisabled === 'true',
    );
  }

  @Get('active')
  findActive(@CurrentUser() user: { sub: string }) {
    return this.safetyLocationsService.findAll(user.sub);
  }

  @Get(':id')
  findOne(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.safetyLocationsService.findOne(user.sub, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { sub: string },
    @Param('id') id: string,
    @Body() dto: UpdateSafetyLocationDto,
  ) {
    return this.safetyLocationsService.update(user.sub, id, dto);
  }

  @Delete(':id')
  disable(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.safetyLocationsService.disable(user.sub, id);
  }
}
