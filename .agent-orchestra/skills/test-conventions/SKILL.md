---
name: Test Conventions
description: Testing patterns and conventions for code review. Covers naming, AAA structure, boundary testing, mock vs real dependencies, and coverage expectations.
version: 1.0.0
license: MIT
triggers:
  lenses:
    - testing
---

When reviewing test code, apply the following conventions to assess quality and completeness.

## Test Naming

Test names must be readable as documentation. Use the pattern: `<unit> should <behavior> when <condition>`. For example: `getUserById should return null when user does not exist`. Avoid names like `test1`, `works`, or `happy path`. Describe the observable behavior, not the implementation detail.

## Arrange-Act-Assert Structure

Every test should follow the AAA pattern with a blank line separating each phase. Flag tests that perform multiple actions or mix assertions with setup. The Act phase should contain exactly one call to the unit under test. Verify that the assertion validates only the outcome of that single action.

## Boundary and Edge Cases

Check that tests cover: empty inputs, null/undefined values, zero and negative numbers, maximum boundary values, empty arrays and objects, and strings with special characters. Flag tests that only cover the happy path. For numeric logic, verify off-by-one boundaries are tested.

## Mock vs Real Dependencies

Real implementations should be used for: pure functions, value objects, and domain logic. Mocks are appropriate for: external HTTP services, databases, file system, clocks, and random number generators. Flag over-mocking — when a unit test mocks the very collaborator it is supposed to test through. Verify mocks are reset between tests to prevent state leakage.

## Test Isolation

Each test must be independently executable. Flag shared mutable state between tests (module-level variables mutated in tests). Verify `beforeEach`/`afterEach` cleanup is complete. Check that test execution order does not affect results.

## Coverage Expectations

Critical paths (authentication, payment, data mutation) should have explicit branch coverage for both success and failure paths. Flag untested error handling branches. When reviewing new features, verify that at minimum: the primary success path, at least one failure path, and edge case inputs are covered.

## Assertion Quality

Assertions must be specific. Flag `expect(result).toBeTruthy()` where `expect(result).toBe(true)` is appropriate. Avoid asserting on irrelevant properties. For collections, verify both membership and order when order matters.
