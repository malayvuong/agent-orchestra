---
name: React Hooks Review
description: Deep review of React hook usage — dependency arrays, custom hook patterns, stale closures, re-render traps, and rules of hooks violations.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - performance
  keywords:
    - react
    - hooks
    - useState
    - useEffect
    - useMemo
    - useCallback
---

When reviewing React code, apply the following hook-specific checks systematically.

## Rules of Hooks Violations

Verify hooks are only called at the top level of function components or custom hooks. Flag hooks inside conditionals, loops, nested functions, or early-return branches. Check that hook call order is deterministic across renders — any conditional logic that changes the number of hooks called is a crash-level bug.

## useEffect Dependency Arrays

For every `useEffect`, verify the dependency array is exhaustive. Flag missing dependencies that are read inside the effect body. Flag object or array literals created inline and passed as dependencies — these cause infinite re-render loops because they fail referential equality on every render. Check that functions used inside effects are either stable (from `useCallback`) or listed as dependencies.

When the dependency array is empty `[]`, verify the effect genuinely runs only on mount. Flag effects with empty deps that read props or state — these capture stale values permanently.

## Stale Closures

Check for closures that capture state or props values at render time and use them in async callbacks, timers, or event handlers that fire later. The captured value will be stale if the component re-renders before the callback fires. Flag patterns like:

- `setTimeout(() => setState(count + 1), 1000)` where `count` is stale
- Event listeners attached in `useEffect` that read state without the functional updater form
- Async functions inside effects that use state variables captured at effect creation time

Recommend functional updater form (`setState(prev => prev + 1)`) or `useRef` for values that must be current.

## useMemo and useCallback Overuse

Flag `useMemo` wrapping primitive computations (string concatenation, simple math) — the memoization overhead exceeds the computation cost. Flag `useCallback` on functions that are not passed as props to memoized child components — wrapping a function in `useCallback` is pointless if no consumer compares it by reference.

Conversely, flag expensive computations (array sorts, filters, transforms over large datasets) that are NOT memoized and run on every render.

## Re-render Traps

Check for patterns that cause unnecessary re-renders:

- Object or array spread in JSX props: `style={{ color: 'red' }}` creates a new object every render
- Inline arrow functions as props to memoized children: `onClick={() => handleClick(id)}` defeats `React.memo`
- Context providers with non-memoized value objects: `<Ctx.Provider value={{ a, b }}>` re-renders all consumers on every provider render
- State updates inside render (not in effects or handlers) causing render loops

## Custom Hook Patterns

Verify custom hooks:

- Return stable references when possible (memoize return objects/arrays)
- Do not trigger unnecessary re-renders in consuming components
- Follow the `use` prefix naming convention
- Do not contain side effects in the render path (only in effects or callbacks)
- Expose cleanup mechanisms when they manage subscriptions or timers

## State Management Anti-Patterns

Flag these common mistakes:

- Derived state stored in `useState` when it could be computed from existing state/props
- Multiple `useState` calls for related values that should be a single object or `useReducer`
- State updated in both `useEffect` and event handlers for the same value (race condition)
- Missing `useReducer` for complex state transitions that involve multiple related fields

## Concurrent Mode and Strict Mode

Check whether the codebase enables React Strict Mode. If enabled, verify effects are idempotent — Strict Mode double-invokes effects in development to catch non-idempotent cleanup. Flag effects that assume they run exactly once when Strict Mode is active.

For each finding, report: the component name, the specific hook, the issue, and a concrete fix.
