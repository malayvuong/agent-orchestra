---
name: Rust Safety Review
description: Deep review of Rust code — unsafe blocks, ownership patterns, lifetime issues, error handling, concurrency, and common footguns.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - security
    - logic
  keywords:
    - rust
    - unsafe
    - ownership
    - lifetime
    - borrow
---

When reviewing Rust code, apply the following language-specific checks.

## Unsafe Block Audit

Every `unsafe` block must be individually justified. For each unsafe block, verify:

- The safety invariant is documented in a comment directly above the block
- The invariant is actually upheld by surrounding code
- The unsafe operation cannot be replaced by a safe alternative
- The scope of the unsafe block is minimal — only the operation that requires unsafe, not surrounding safe code

Flag `unsafe impl` for traits without documentation of the safety contract. Flag unsafe blocks that perform multiple unrelated unsafe operations — each should be in its own block with its own justification.

Check for `unsafe` in public APIs — if a function requires callers to uphold invariants, it should be marked `unsafe fn` and documented.

## Ownership and Borrowing

Flag unnecessary `.clone()` calls that exist only to satisfy the borrow checker — these often indicate a design problem. Check for:

- `clone()` inside loops where a reference would suffice
- `clone()` on large data structures (Vec, HashMap, String) passed to functions that only need a reference
- `Arc<Mutex<T>>` where `&mut T` or channel-based communication would be simpler

Verify `String` vs `&str` usage: functions that only read strings should accept `&str`, not `String` or `&String`. Same for `Vec<T>` vs `&[T]`.

## Lifetime Issues

Flag explicit lifetimes that could be elided — unnecessary lifetime annotations add complexity. Check that lifetime bounds on structs accurately reflect the relationship between the struct and its borrowed data.

Flag `'static` lifetime bounds on trait objects or generics where a shorter lifetime would work. Check for patterns that force `'static` unnecessarily (spawning tasks with `tokio::spawn` that capture local references).

## Error Handling

Flag `unwrap()` and `expect()` in library code — these panic instead of propagating errors. In application code, `unwrap()` is acceptable only with a comment explaining why the value is guaranteed to be `Some`/`Ok`.

Verify `?` operator is used for error propagation instead of manual `match` on `Result`. Flag error types that implement `Display` but not `Error`. Check that custom error types implement `From<T>` for the errors they wrap — this enables `?` chaining.

Flag `panic!()` in library code. Flag `process::exit()` in library code — only binaries should decide to exit.

## Concurrency

Verify `Arc` is used instead of `Rc` when data crosses thread boundaries. Flag `Mutex` lock scopes that are larger than necessary — hold the lock only for the critical section. Check for potential deadlocks from multiple mutex acquisitions in different orders.

Flag `unsafe impl Send` or `unsafe impl Sync` without documentation of why the type is safe to share across threads. Verify channel-based communication (`mpsc`, `crossbeam`) is preferred over shared mutable state when the pattern fits.

## Common Footguns

Flag integer overflow in release mode — Rust wraps by default in release. Use `checked_add`, `saturating_add`, or `wrapping_add` when overflow is possible. Check for off-by-one errors in slice indexing — prefer `.get()` with option handling over direct indexing.

Flag `mem::transmute` — this is almost always wrong. Flag `mem::forget` unless it is paired with a corresponding `ManuallyDrop` pattern. Check for `std::mem::uninitialized` usage — use `MaybeUninit` instead.

## Dependencies

Check `Cargo.toml` for wildcard version specifiers (`*`). Verify that `unsafe` crates in the dependency tree are audited. Flag `build.rs` scripts that download or execute external code at compile time.

For each finding, report: the function or module, the specific pattern, the risk level, and the recommended fix.
