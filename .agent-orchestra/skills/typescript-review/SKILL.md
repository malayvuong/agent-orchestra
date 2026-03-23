---
name: TypeScript Review
description: Deep review of TypeScript code — type safety, generics patterns, strict mode compliance, type narrowing, module boundaries, and common escape hatches.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - consistency
  keywords:
    - typescript
    - ts
    - generics
    - type
    - interface
---

When reviewing TypeScript code, apply the following language-specific checks.

## any Escape Hatches

Flag every use of `any` — each must be individually justified. Check for:

- `as any` casts that silence the compiler instead of fixing the type
- Function parameters typed as `any` when a generic or union would work
- `@ts-ignore` or `@ts-expect-error` without a comment explaining why
- `JSON.parse()` results used without runtime validation or type assertion to a validated shape
- Third-party library types overridden with `any` instead of using declaration merging or module augmentation

Verify `strict: true` is enabled in `tsconfig.json`. Flag `noImplicitAny: false` or `strictNullChecks: false` — these disable the most valuable safety checks.

## Generics

Flag overly complex generic signatures with more than 3 type parameters — these are usually a design smell. Check that generic constraints (`extends`) are used when the generic is not truly unconstrained. Flag `T extends object` when a more specific constraint exists.

Flag generics that are used only once in a signature — a generic that appears only in the return type or only in one parameter adds complexity without value. Check for generic parameters that shadow built-in types (`T`, `Error`, `Response`).

## Type Narrowing

Verify type guards are used instead of unsafe casts. Flag `value as Type` where a type guard (`if ('key' in value)`, `instanceof`, `typeof`) would provide runtime safety. Check that discriminated unions use the discriminant field for narrowing, not `as` casts.

Flag `!` non-null assertions on values that could actually be null — each `!` should have a comment explaining the invariant. Verify optional chaining (`?.`) is used instead of `&&` chains for deeply nested property access.

## Module Boundaries

Verify barrel exports (`index.ts`) do not re-export internal implementation details. Flag circular imports — these cause runtime errors or undefined values depending on module resolution. Check that types used across module boundaries are explicitly exported, not inferred.

Flag `import type` that should be used for type-only imports — this prevents the import from appearing in compiled output. Verify path aliases in `tsconfig.json` are consistent with actual directory structure.

## Enums and Constants

Flag numeric enums without explicit values — auto-incrementing enums are fragile when members are reordered. Prefer `const enum` for enums that should be inlined, or use string literal unions (`type Status = 'active' | 'inactive'`) for most cases.

Flag `enum` used where a plain object `as const` would suffice — const assertions provide better type inference and tree-shaking.

## Async Patterns

Flag `async` functions that never `await` — the `async` keyword adds unnecessary Promise wrapping. Verify error handling exists for every `await` — either try/catch locally or the promise rejection propagates to a handler.

Flag floating promises (async function called without `await` or `.catch()`). Check for `Promise<void>` return types that swallow errors silently.

## Utility Type Misuse

Flag `Partial<T>` on types where most fields are actually required — this weakens the contract. Flag `Record<string, any>` where a more specific type exists. Check that `Omit<T, K>` and `Pick<T, K>` use string literal keys that actually exist on `T` — typos in the key silently compile.

For each finding, report: the file, the specific TypeScript pattern, and the recommended fix.
