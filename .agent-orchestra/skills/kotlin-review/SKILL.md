---
name: Kotlin Review
description: Deep review of Kotlin code — coroutine patterns, null safety, data classes, Flow/StateFlow, Android lifecycle, and Jetpack Compose patterns.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - performance
  keywords:
    - kotlin
    - android
    - coroutine
    - flow
    - jetpack
    - compose
---

When reviewing Kotlin code, apply the following language and platform checks.

## Null Safety

Flag `!!` (not-null assertion) without a justifying comment — each `!!` is a potential `NullPointerException`. Flag platform types from Java interop used without null checks — these bypass Kotlin's null safety.

Verify `?.let { }` or `?.run { }` is used instead of `if (x != null)` blocks when the result is used as an expression. Flag `lateinit var` on types that could be nullable — use `var x: Type? = null` when the uninitialized state is a valid program state.

Check that `requireNotNull()` and `checkNotNull()` are used with descriptive messages for developer-facing assertions. Flag `as` unsafe casts — use `as?` with null handling.

## Coroutines

Verify `viewModelScope` or `lifecycleScope` is used for Android coroutines — not `GlobalScope`. Flag `GlobalScope.launch` — it leaks coroutines that outlive their intended lifecycle. Check that `supervisorScope` is used when child coroutine failures should not cancel siblings.

Flag `runBlocking` in production code outside of `main()` — it blocks the calling thread. Flag `Dispatchers.IO` for CPU-intensive work — use `Dispatchers.Default`. Verify `withContext(Dispatchers.IO)` wraps blocking I/O calls inside suspend functions.

Check that structured concurrency is maintained — every launched coroutine should be a child of a meaningful scope. Flag `launch` inside `launch` without clear parent-child hierarchy.

## Flow and StateFlow

Verify `StateFlow` is used for UI state instead of `LiveData` in new code. Flag `Flow.collect()` in `init` blocks without a lifecycle-aware collector — use `repeatOnLifecycle(STARTED)` or `collectAsStateWithLifecycle()` in Compose.

Flag `MutableStateFlow` exposed publicly — expose as `StateFlow` (read-only). Check that `SharedFlow` replay is configured appropriately — `replay = 0` drops events for slow collectors, `replay = 1` replays the latest.

Flag `flowOn()` after `collect()` — it has no effect. `flowOn` changes the upstream dispatcher, it must be before terminal operators.

## Data Classes

Verify `data class` is used for value types that are primarily data carriers. Flag `data class` with mutable properties (`var`) — data classes should be immutable. Check that `copy()` is intentionally supported — data classes with complex internal state may produce inconsistent copies.

Flag `data class` implementing interfaces with side-effect methods — the auto-generated `equals()`, `hashCode()`, and `toString()` only consider constructor properties, which may violate the interface contract.

## Android Lifecycle

Flag `Activity` or `Fragment` references held in singletons, ViewModels, or static fields — these leak the entire UI context. Verify `ViewModel` does not hold references to `Context`, `View`, or `Fragment`.

Check that `repeatOnLifecycle` is used for Flow collection in Fragments — not `launchWhenStarted` (deprecated). Flag `onDestroy` cleanup that should be in `onDestroyView` for Fragments with retained view bindings.

## Jetpack Compose

Verify `remember` is used for expensive computations in composable functions. Flag `mutableStateOf()` without `remember` — the state resets on every recomposition. Check that `derivedStateOf` is used for computed values that depend on other state.

Flag side effects in composable bodies — use `LaunchedEffect`, `SideEffect`, or `DisposableEffect`. Flag `LaunchedEffect(Unit)` — this runs only once; use a meaningful key that triggers re-launch when the effect should restart.

Verify `key()` is used in lazy lists for stable item identification. Flag `items(list)` without a `key` parameter — this causes unnecessary recomposition when the list changes.

## Kotlin Idioms

Flag Java-style code: `for (i in 0 until list.size)` instead of `list.forEachIndexed`, manual null checks instead of scope functions (`let`, `also`, `apply`), `StringBuilder` instead of `buildString`. Flag `when` expressions without exhaustive branches for sealed classes.

For each finding, report: the file and function, the specific Kotlin/Android pattern, and the recommended fix.
