---
name: Vue.js Review
description: Deep review of Vue.js applications — Composition API patterns, reactivity traps, component design, Pinia state management, and performance pitfalls.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - performance
  keywords:
    - vue
    - vuejs
    - composition api
    - pinia
    - ref
    - reactive
    - computed
---

When reviewing Vue.js code, apply the following framework-specific checks.

## Reactivity Traps

Flag destructuring of reactive objects without `toRefs()` — destructured properties lose reactivity. Check for:

- `const { name, age } = props` in `<script setup>` — use `toRefs(props)` or access `props.name` directly
- `const { count } = store` where `store` is a Pinia store — use `storeToRefs(store)`
- Replacing a reactive object's value instead of mutating it: `state = { ...newState }` breaks reactive references

Verify `ref()` is used for primitives and `reactive()` for objects. Flag `reactive()` wrapping a primitive — it has no effect. Flag `.value` access on reactive objects (not needed) and missing `.value` on refs in script (needed).

## Computed Properties

Flag computed properties with side effects (API calls, mutations, DOM manipulation) — computeds must be pure derivations. Flag computed properties that return new object/array references on every evaluation — this defeats Vue's change detection and causes unnecessary re-renders.

Verify expensive computations are wrapped in `computed()` and not recalculated in the template or in `watchEffect`. Flag template expressions that perform filtering, sorting, or mapping inline — extract to computed.

## Watchers

Flag `watch()` and `watchEffect()` that modify the same reactive source they observe — this creates infinite loops. Verify `watch()` uses the correct source signature: watching a ref requires `() => ref.value` or just `ref`, not `ref.value` (which captures a static primitive).

Check that watchers have cleanup via `onCleanup` parameter when they start async operations (timers, fetch, subscriptions). Flag `watchEffect()` used where `watch()` with explicit dependencies would be clearer about intent.

## Component Design

Verify props use TypeScript types with `defineProps<T>()` — not runtime-only validation. Flag components with more than 10 props — consider splitting into smaller components or using a configuration object prop. Check that `defineEmits<T>()` is typed for all emitted events.

Flag `v-model` on complex objects passed as props — parent and child both modify the same reference, breaking one-way data flow. Verify `provide/inject` is typed with `InjectionKey<T>` for type safety.

## Pinia State Management

Verify stores use the setup syntax (`defineStore('id', () => { ... })`) for Composition API consistency. Flag direct mutations of store state from components — use actions for state changes that involve logic.

Check that store getters are used for derived state instead of computing it in each component. Flag stores that hold UI state (modal open/close, tab selection) alongside domain data — separate concerns into distinct stores.

## Template Performance

Flag `v-if` and `v-for` on the same element — `v-if` has higher priority and may cause unexpected behavior. Verify `v-for` always has a `:key` binding with a unique identifier, not the array index. Flag `:key="index"` — index keys cause rendering bugs when the list is reordered or filtered.

Check for expensive method calls in templates that run on every re-render. Flag deep object comparison in templates (`v-if="JSON.stringify(a) === JSON.stringify(b)"`) — use computed properties.

## Lifecycle and Async

Verify `onMounted` is used for DOM-dependent initialization, not `setup()` body. Flag `await` in `setup()` without `<Suspense>` wrapper in the parent — the component will not render until the promise resolves. Check that `onUnmounted` cleans up event listeners, timers, and subscriptions.

For each finding, report: the component file, the specific Vue pattern violated, and the recommended fix.
