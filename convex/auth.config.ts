import type { AuthConfig } from "convex/server";

/**
 * Convex validates Clerk-issued JWTs (template / integration "convex").
 * CLERK_JWT_ISSUER_DOMAIN is set in the Convex dashboard (or `npx convex env set`)
 * to the Clerk Frontend API URL, e.g. https://your-app.clerk.accounts.dev
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
