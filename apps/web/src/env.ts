import { defineEnvVars } from '@sveltejs/kit/env';

const LOCAL_API_URL = 'http://localhost:3000';

export const variables = defineEnvVars({
  PUBLIC_API_URL: {
    public: true,
    description: `Base URL of the backend as the browser reaches it; ${LOCAL_API_URL} when unset`,
    schema: (value = LOCAL_API_URL) => {
      if (!URL.canParse(value)) {
        throw new Error(`PUBLIC_API_URL must be an absolute URL, e.g. ${LOCAL_API_URL}`);
      }
      return value.replace(/\/+$/, '');
    },
  },
});
