---
name: Go Review
description: Deep review of Go code — error handling, goroutine management, context propagation, interface design, and concurrency patterns.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - performance
  keywords:
    - golang
    - go
    - goroutine
    - channel
    - context
---

When reviewing Go code, apply the following language-specific checks.

## Error Handling

Flag any `err` that is assigned but not checked. Every function that returns an error must have its error value inspected — not discarded with `_`. Flag `errors.New()` with dynamic strings that should use `fmt.Errorf("...: %w", err)` for wrapping.

Verify error wrapping uses `%w` verb (not `%v` or `%s`) to preserve the error chain for `errors.Is()` and `errors.As()`. Flag sentinel errors that are variables instead of unexported types — sentinel errors should use `errors.New` at package level.

Check for panics in library code — libraries should return errors, not panic. Flag `log.Fatal` in library code — this calls `os.Exit(1)` and prevents callers from handling the error.

## Goroutine Leaks

For every `go func()` launch, verify there is a mechanism to stop it: context cancellation, done channel, or WaitGroup. Flag goroutines that block on channel reads with no exit path — if the channel is never closed or the context is never cancelled, the goroutine leaks forever.

Check that goroutines launched in HTTP handlers respect the request context. Flag goroutines that outlive the handler without explicit lifecycle management. Verify `defer cancel()` is called for every `context.WithCancel` or `context.WithTimeout`.

## Context Propagation

Verify `context.Context` is the first parameter of every function that does I/O, launches goroutines, or calls other context-aware functions. Flag functions that accept `context.Background()` when a parent context is available. Flag `context.TODO()` in production code — it should only appear in code that is being migrated.

Check that long-running operations check `ctx.Done()` periodically. Flag database queries, HTTP requests, and RPC calls that do not pass the context.

## Interface Design

Flag interfaces with more than 5 methods — Go favors small interfaces. Verify interfaces are defined where they are consumed (not where they are implemented). Flag exported interfaces that have only one implementation — this is premature abstraction.

Check for `interface{}` (or `any`) parameters that should be typed. Flag type assertions without the comma-ok pattern (`val := x.(Type)` instead of `val, ok := x.(Type)`).

## Concurrency Patterns

Flag shared state protected by `sync.Mutex` when a channel would be cleaner. Verify `sync.WaitGroup` counter matches the number of goroutines launched. Flag `sync.WaitGroup` passed by value — it must be passed by pointer.

Check for data races: flag struct fields accessed by multiple goroutines without synchronization. Flag map reads and writes from multiple goroutines without `sync.RWMutex` or `sync.Map`.

Verify `select` statements include a `default` case only when non-blocking behavior is intended. Flag `select` with a single case — use a direct channel operation instead.

## Resource Management

Verify `defer` is used for cleanup (file close, mutex unlock, connection release). Flag `defer` inside loops — deferred calls accumulate until the function returns, not the loop iteration. Use explicit close calls inside loops instead.

Check that `http.Response.Body` is always closed with `defer resp.Body.Close()`. Flag HTTP clients that use `http.DefaultClient` without timeout configuration.

## Performance

Flag `append` in a loop without pre-allocating the slice with `make([]T, 0, expectedLen)`. Flag string concatenation in loops — use `strings.Builder`. Check for unnecessary allocations in hot paths: prefer passing pointers to large structs rather than copying by value.

For each finding, report: the function or package, the specific Go pattern violated, and the recommended fix.
