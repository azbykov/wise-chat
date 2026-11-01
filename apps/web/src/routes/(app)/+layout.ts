import { error, redirect } from '@sveltejs/kit';
import { errorMessage } from '#lib/api/http.js';
import { auth } from '#lib/app.js';

/** Signed-in pages only: anyone else goes to sign in, and comes back here afterwards. */
export async function load({ url }) {
  const status = await auth.init().catch((cause: unknown) => error(503, errorMessage(cause)));
  if (status === 'anonymous') {
    redirect(307, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
}
