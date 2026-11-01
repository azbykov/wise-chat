import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ListUsersQuery } from './dto/list-users.query';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query() query: ListUsersQuery, @CurrentUser() user: AuthUser) {
    return this.users.list(query, user.id);
  }
}
