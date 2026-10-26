import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL!;
  // The pg driver ignores the ?schema= param (only Prisma migrate reads it),
  // so extract it and pass it to the adapter explicitly.
  const schema =
    new URL(connectionString).searchParams.get('schema') ?? undefined;
  const adapter = new PrismaPg({ connectionString }, { schema });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
