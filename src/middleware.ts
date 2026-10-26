import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Pages and APIs reachable without a Clerk session. Participants (player,
// judge) authenticate with a per-game token instead; every /api/game route
// does its own auth (Clerk for host actions, token for participant actions).
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/game/(.*)/play(.*)',
  '/game/(.*)/judge(.*)',
  '/game/(.*)/results(.*)',
  '/api/game(.*)',
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
