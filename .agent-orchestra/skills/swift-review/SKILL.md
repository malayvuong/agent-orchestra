---
name: Swift Review
description: Deep review of Swift code — memory management, concurrency patterns, optionals, protocol design, SwiftUI lifecycle, and iOS platform patterns.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - performance
  keywords:
    - swift
    - ios
    - swiftui
    - uikit
    - xcode
    - apple
---

When reviewing Swift code, apply the following language and platform checks.

## Memory Management

Flag strong reference cycles in closures — closures that capture `self` strongly and are stored by `self` (delegates, completion handlers, timers) leak memory. Verify `[weak self]` or `[unowned self]` is used in escaping closures that reference the enclosing class.

Check that `[unowned self]` is only used when the closure's lifetime is guaranteed to be shorter than `self`'s lifetime. Flag `[unowned self]` in network completion handlers or async callbacks — the object may be deallocated before the callback fires.

Flag `NotificationCenter` observers that are not removed in `deinit`. Flag delegates declared as `strong` instead of `weak` — delegate properties should always be `weak var delegate: Protocol?`.

## Optionals

Flag force-unwrapping (`!`) without a justifying comment. Each `!` should have a clear invariant that guarantees the value is non-nil. Flag `implicitlyUnwrappedOptional` declarations outside of `@IBOutlet` — these are crashes waiting to happen.

Verify `guard let` or `if let` is used for optional binding instead of force-unwrapping in conditional chains. Flag nested `if let` pyramids — flatten with `guard` statements. Check that optional chaining (`?.`) is used instead of `if let` when the result is immediately discarded.

## Concurrency (Swift Concurrency)

Verify `@MainActor` is applied to UI-updating code. Flag `DispatchQueue.main.async` in code that already uses Swift Concurrency — mixing patterns causes confusion. Check that `Task` instances are stored and cancelled when the owning view or controller is deallocated.

Flag `nonisolated` functions that access actor-isolated state without `await`. Verify `Sendable` conformance for types passed across actor boundaries. Flag `@unchecked Sendable` without documentation of the safety invariant.

Flag blocking operations (`Thread.sleep`, synchronous network calls) on the main actor — these freeze the UI.

## Protocol Design

Flag protocols with more than 5 required methods — split into smaller, composable protocols. Verify protocol extensions provide default implementations for methods that have a natural default. Flag `@objc` protocol requirements that could be pure Swift.

Check that protocol witness types are value types (`struct`) when possible for performance. Flag protocols that require `class` conformance (`AnyObject`) when value types would work.

## SwiftUI Patterns

Flag `@State` used for data that should be `@StateObject` (reference types) or `@Binding` (parent-owned). Verify `@ObservedObject` is not used for objects the view creates — use `@StateObject` to own the lifecycle. Flag `@EnvironmentObject` without a corresponding `environmentObject()` modifier in the view hierarchy.

Check that expensive computations are not in the `body` property — extract to computed properties or move to the view model. Flag `onAppear` for data loading when `task` modifier would be better (auto-cancellation on disappear).

Flag frequent view rebuilds caused by `@Published` on high-frequency data sources (timers, sensors). Throttle updates or use `Equatable` conformance to prevent unnecessary rebuilds.

## Error Handling

Verify `do-catch` is used instead of `try?` when the error matters. Flag `try?` that silently discards errors in critical paths (file I/O, network, database). Flag `catch` blocks that only catch the base `Error` type — catch specific error types first.

Check that custom error types conform to `LocalizedError` with a meaningful `errorDescription`. Flag error messages that expose internal details to users.

For each finding, report: the file and function, the specific Swift/iOS pattern, and the recommended fix.
