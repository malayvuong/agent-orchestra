---
name: Next.js Review
description: Deep review of Next.js applications — server/client boundaries, data fetching, caching, middleware, route handlers, and App Router patterns.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - performance
    - security
  keywords:
    - nextjs
    - next
    - app router
    - server component
    - server action
---

When reviewing Next.js code, apply the following framework-specific checks.

## Server and Client Component Boundaries

Verify every component's rendering environment. Flag `'use client'` directives that are missing when browser APIs (`window`, `document`, `localStorage`, `addEventListener`) are used. Flag `'use client'` directives that are unnecessary — components that only render HTML and call no browser APIs should be Server Components by default.

Check that Server Components do not import Client Components in a way that forces the server tree to become client-rendered. Verify that shared layout components do not accidentally pull large client bundles into the server tree.

## Data Fetching Patterns

For App Router: verify `fetch()` calls in Server Components use appropriate cache and revalidation options. Flag `fetch()` without `cache` or `next.revalidate` options — the default caching behavior has changed across Next.js versions and should be explicit.

Flag `useEffect` + `fetch` in Client Components for data that could be loaded in a Server Component or via `generateStaticParams`. This pattern causes waterfalls and loading spinners that server-side fetching eliminates.

Check that `generateStaticParams` is used for known dynamic segments at build time. Flag dynamic routes that serve a finite set of pages but use runtime fetching instead of static generation.

## Server Actions

Verify Server Actions (`'use server'`) validate all input — they are publicly accessible API endpoints. Flag Server Actions that trust client-supplied IDs without authorization checks. Verify form submissions using Server Actions handle errors gracefully and do not expose internal error messages to the client.

Check that Server Actions do not perform expensive operations synchronously — they should use `revalidatePath` or `revalidateTag` to trigger background revalidation rather than blocking the response.

## Route Handlers

Verify `route.ts` handlers validate HTTP methods explicitly. Flag route handlers that accept any method without checking `request.method`. Check that response headers include appropriate CORS, Content-Type, and cache-control values.

Flag route handlers that read request body without size limits — large payloads can exhaust server memory.

## Middleware

Check that `middleware.ts` runs only the logic that must execute on every request. Flag middleware that performs database queries, external API calls, or heavy computation — middleware runs on the Edge runtime and has strict execution time limits.

Verify middleware correctly handles redirect and rewrite responses. Flag middleware that returns `NextResponse.next()` without modifications — it adds overhead for no purpose.

## Caching and Revalidation

Flag pages that use `export const dynamic = 'force-dynamic'` without justification — this disables all caching. Verify `revalidate` intervals are appropriate for the data freshness requirements. Check that `unstable_cache` or `cache()` wrappers are used for expensive data operations that are shared across requests.

Flag stale-while-revalidate patterns where the revalidation window is too long for user-facing data that must appear fresh.

## Image and Asset Optimization

Verify `next/image` is used instead of raw `<img>` tags. Flag images without `width` and `height` attributes — these cause layout shift. Check that large images use the `priority` prop for above-the-fold content and lazy loading for below-the-fold.

## Environment Variables

Flag `NEXT_PUBLIC_` environment variables that contain secrets — these are embedded in the client bundle. Verify server-only environment variables are not accessed in Client Components. Check that `.env.local` is in `.gitignore`.

For each finding, report: the file, the Next.js-specific pattern violated, and the recommended fix.
