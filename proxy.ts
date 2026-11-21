import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Clerk's middleware only attaches the session to each request. Route-level
 * protection lives in app/(app)/layout.tsx (resource-based checks, as Clerk
 * recommends), and real authorization happens in every Convex function.
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
