import { auth, currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/db';

/**
 * Get or create the internal user from Clerk auth.
 * Returns the internal user ID (UUID).
 */
export async function getAuthenticatedUser() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;

  // Try to find by externalId (Clerk ID)
  let user = await prisma.user.findUnique({
    where: { externalId: clerkId },
  });

  if (!user) {
    // Create user from Clerk profile
    const clerkUser = await currentUser();
    if (!clerkUser) return null;

    user = await prisma.user.create({
      data: {
        email: clerkUser.emailAddresses[0]?.emailAddress ?? '',
        externalId: clerkId,
        displayName:
          clerkUser.firstName && clerkUser.lastName
            ? `${clerkUser.firstName} ${clerkUser.lastName}`
            : clerkUser.username ?? 'Anonymous',
      },
    });
  }

  return user;
}

/**
 * Validate a game participant token.
 * Returns the participant record or null.
 */
export async function validateParticipantToken(token: string) {
  if (!token) return null;

  return prisma.gameParticipant.findUnique({
    where: { token },
    include: { game: true },
  });
}
