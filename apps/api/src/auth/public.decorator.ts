import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

/** Opens a route to anonymous callers; every other route requires an access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
