/**
 * Targeted Cache Revalidation Helper
 * Safely calls Next.js revalidatePath when executed inside Next.js server runtime,
 * and gracefully no-ops when executed inside standalone Node/CLI scripts.
 */
export async function triggerRevalidation(path: string, type?: 'page' | 'layout'): Promise<boolean> {
  try {
    const { revalidatePath } = await import('next/cache');
    revalidatePath(path, type);
    return true;
  } catch {
    // Graceful no-op outside Next.js runtime environment (e.g. CLI worker or test)
    return false;
  }
}

/**
 * Revalidates all core newsroom feeds and article pages
 */
export async function revalidatePublishedContent(slug?: string): Promise<void> {
  await triggerRevalidation('/');
  await triggerRevalidation('/admin/newsroom');
  if (slug) {
    await triggerRevalidation(`/article/${slug}`);
  }
}
