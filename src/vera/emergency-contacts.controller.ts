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
import { CreateEmergencyContactDto } from './dto/create-emergency-contact.dto';
import { UpdateEmergencyContactDto } from './dto/update-emergency-contact.dto';
import { EmergencyContactsService } from './emergency-contacts.service';

@UseGuards(JwtGuard)
@Controller('vera/emergency-contacts')
export class EmergencyContactsController {
  constructor(
    private readonly emergencyContactsService: EmergencyContactsService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: { sub: string },
    @Body() dto: CreateEmergencyContactDto,
  ) {
    return this.emergencyContactsService.create(user.sub, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: { sub: string },
    @Query('includeDisabled') includeDisabled?: string,
  ) {
    return this.emergencyContactsService.findAll(
      user.sub,
      includeDisabled === 'true',
    );
  }

  @Get(':id')
  findOne(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.emergencyContactsService.findOne(user.sub, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { sub: string },
    @Param('id') id: string,
    @Body() dto: UpdateEmergencyContactDto,
  ) {
    return this.emergencyContactsService.update(user.sub, id, dto);
  }

  @Delete(':id')
  disable(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.emergencyContactsService.disable(user.sub, id);
  }
}
