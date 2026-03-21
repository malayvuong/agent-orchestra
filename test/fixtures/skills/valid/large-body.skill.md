---
name: large-body-test
description: A test skill with a body exceeding 2000 tokens to test summary truncation behavior.
version: 1.0.0
license: MIT
triggers:
  lenses: [testing]
---

# Large Body Test Skill

This skill is designed to test progressive disclosure and summary truncation when the full body exceeds the context budget.

## Section 1: Code Review Guidelines

When reviewing code, consider the following aspects carefully. First, examine the overall architecture and ensure it follows established patterns. Check that separation of concerns is maintained throughout the codebase. Verify that the dependency injection pattern is used consistently. Look for any circular dependencies between modules. Ensure that interfaces are used to define contracts between components.

Review the error handling strategy. All errors should be caught and handled appropriately. Network errors should be retried with exponential backoff. Validation errors should return structured error responses. Internal errors should be logged with sufficient context for debugging. Never swallow errors silently.

Check the test coverage for all new code. Unit tests should cover happy paths and edge cases. Integration tests should verify component interactions. End-to-end tests should validate critical user workflows. Test names should clearly describe what is being tested. Assertions should be specific and meaningful.

## Section 2: Performance Considerations

Analyze the performance impact of changes. Check for N+1 query patterns in database access code. Verify that appropriate indexes exist for new queries. Look for unnecessary data fetching or over-fetching patterns. Ensure pagination is used for list endpoints. Check that caching is applied where appropriate.

Review memory usage patterns. Watch for memory leaks in event listeners or subscriptions. Ensure large data structures are properly cleaned up. Check for unnecessary object copying or cloning. Verify that streams are used for large file processing. Monitor for excessive string concatenation in loops.

Evaluate network request patterns. Minimize the number of HTTP round trips. Use batch APIs where available. Implement request deduplication for concurrent identical requests. Set appropriate timeouts for all external calls. Add circuit breakers for unreliable dependencies.

## Section 3: Security Review Checklist

Input validation is critical for all user-facing endpoints. Validate all request parameters against expected types and ranges. Sanitize string inputs to prevent injection attacks. Use parameterized queries for all database operations. Validate file uploads for type, size, and content. Implement rate limiting for authentication endpoints.

Authentication and authorization must be verified at every layer. Check that authentication tokens are validated on every request. Verify that authorization checks use the principle of least privilege. Ensure that session management follows current best practices. Check for insecure direct object reference vulnerabilities. Verify that sensitive operations require re-authentication.

Data protection measures should be comprehensive. Ensure sensitive data is encrypted at rest and in transit. Check that API responses do not leak internal implementation details. Verify that error messages do not expose sensitive information. Ensure that logs do not contain passwords, tokens, or personal data. Check that temporary files are properly cleaned up after use.

## Section 4: Code Style and Maintainability

Naming conventions should be clear and consistent throughout the codebase. Variable names should describe their purpose, not their type. Function names should describe what the function does, starting with a verb. Class names should be nouns that clearly indicate responsibility. Constants should be UPPER_SNAKE_CASE and defined in a central location.

Documentation should be present for all public APIs. Every exported function should have a JSDoc comment. Complex business logic should have inline comments explaining the reasoning. README files should be kept up to date with architecture changes. API documentation should include examples for common use cases. Deprecated features should be clearly marked with migration guidance.

Code organization should follow the principle of least surprise. Related functionality should be grouped together. Helper functions should be close to where they are used. Avoid deeply nested directory structures. Keep files focused on a single responsibility. Use barrel exports to simplify import paths.

## Section 5: Dependency Management

Review all new dependencies carefully before adding them. Check the maintenance status of each dependency. Verify the license compatibility with your project. Look for known vulnerabilities in the dependency tree. Prefer well-maintained packages with active communities. Consider the bundle size impact of new dependencies.

Keep dependencies up to date regularly. Use automated tools to detect outdated packages. Review changelogs before upgrading major versions. Run the full test suite after any dependency update. Pin dependency versions in production applications. Use lockfiles to ensure reproducible builds across environments.

## Section 6: Deployment and Operations

Verify that deployment configurations are correct. Check environment variable requirements for each service. Ensure database migrations are backward compatible. Verify that health check endpoints are properly configured. Check that monitoring and alerting rules are in place. Ensure that rollback procedures are documented and tested.

Review the operational readiness of new features. Check that appropriate metrics are being collected. Verify that structured logging provides sufficient detail. Ensure that feature flags are used for gradual rollouts. Check that documentation is updated for operations teams. Verify that runbooks exist for common failure scenarios.
