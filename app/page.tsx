import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

/**
 * Root page — server-side auth gate.
 * Checks for the session cookie and redirects accordingly, avoiding an extra
 * round-trip through /dashboard for unauthenticated visitors.
 */
export default async function HomePage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get('sessionId')?.value;

  if (!sessionId) {
    redirect('/login');
  }

  redirect('/dashboard');
}
