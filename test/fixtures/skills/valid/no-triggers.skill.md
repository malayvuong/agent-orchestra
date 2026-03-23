---
name: always-on-style-guide
description: Code style guidelines applied to every review session
version: 2026.2.9
license: Apache-2.0
---

# Code Style Guidelines

This skill is always active and applies general code style guidelines to every review.

## Naming Conventions

- Use descriptive, meaningful names for variables, functions, and classes
- Prefer camelCase for variables and functions in TypeScript/JavaScript
- Use PascalCase for class and type names
- Constants should use UPPER_SNAKE_CASE

## Function Design

- Functions should do one thing and do it well
- Keep functions short (ideally under 20 lines)
- Use early returns to reduce nesting

## Comments

- Write comments that explain "why", not "what"
- Keep comments up to date when code changes
- Use JSDoc for public APIs
