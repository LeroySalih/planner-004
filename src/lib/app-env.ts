import "server-only"

/**
 * True on the coding (test) site, false on the live school site.
 *
 * Set `APP_ENV=coding` in the coding box's `.env`; prod leaves it unset.
 * `NODE_ENV` cannot tell them apart — both run the same production build.
 * Read at request time, never baked in: `.env` is not in the Docker build
 * context, so a build-time read would always see it unset.
 */
export function isCodingSite(): boolean {
  return process.env.APP_ENV === "coding"
}
