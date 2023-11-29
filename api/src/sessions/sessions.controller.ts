import { Controller } from '@nestjs/common';
import { SessionsService } from '@/sessions/sessions.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Sessions')
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}
}
