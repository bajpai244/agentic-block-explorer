import { prisma } from "@/lib/prisma";

export async function getCachedJson<T>(key: string): Promise<T | null> {
  try {
    const hit = await prisma.apiCache.findUnique({ where: { key } });
    if (!hit || hit.expiresAt.getTime() < Date.now()) return null;
    return hit.value as T;
  } catch {
    return null;
  }
}

export async function setCachedJson<T>(
  key: string,
  endpoint: string,
  value: T,
  ttlSeconds: number,
) {
  try {
    await prisma.apiCache.upsert({
      where: { key },
      create: {
        key,
        endpoint,
        value: value as object,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      },
      update: {
        endpoint,
        value: value as object,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      },
    });
  } catch {
    // Cache failures should not break explorer answers.
  }
}
