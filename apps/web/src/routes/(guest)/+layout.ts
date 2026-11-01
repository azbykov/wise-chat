import { redirect } from '@sveltejs/kit';
import { auth } from '#lib/app.js';
import { safeNext } from '#lib/utils/redirect.js';

/** A signed-in user is sent on from the login and register pages. */
export async function load({ url }) {
  const status = await auth.init().catch(() => 'anonymous');
  if (status === 'authenticated') {
    redirect(307, safeNext(url.searchParams.get('next'), url.origin));
  }
}
