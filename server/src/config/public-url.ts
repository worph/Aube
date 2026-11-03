import type { AubeConfig } from '@aube/shared'

/**
 * Aube's own address, for links in notifications: `public_url` when set in config.yaml, else
 * `AUBE_PUBLIC_URL` from the environment (the store listing passes the platform's `APP_URL`),
 * else '' (links are left out). No trailing slash.
 */
export function publicUrl(cfg: Pick<AubeConfig, 'public_url'>): string {
  return (cfg.public_url || process.env.AUBE_PUBLIC_URL || '').replace(/\/+$/, '')
}
