---
name: Laravel Review
description: Deep review of Laravel applications — Eloquent efficiency, middleware patterns, validation, Blade security, queue reliability, and service architecture.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - security
    - performance
  keywords:
    - laravel
    - eloquent
    - blade
    - artisan
    - php
    - middleware
---

When reviewing Laravel code, apply the following framework-specific checks.

## Eloquent N+1 Queries

For every controller or service that iterates over a collection and accesses relationships, verify `with()` eager loading is used. Flag:

- `$users = User::all()` followed by `$user->posts` in a loop — use `User::with('posts')->get()`
- Nested relationship access without nested eager loading: `$user->posts->comments` needs `with('posts.comments')`
- `$model->relationLoaded('name')` not checked before conditional relationship access in serializers

Verify `preventLazyLoading()` is enabled in `AppServiceProvider::boot()` for development environments. Flag `select('*')` on tables with many columns when only a few fields are needed — use `select()` or `->only()`.

## Mass Assignment

Verify every Eloquent model defines `$fillable` or `$guarded`. Flag `$guarded = []` (allows all fields) on models that store sensitive data (roles, permissions, balances). Check that `$request->all()` is never passed directly to `create()` or `update()` — use `$request->validated()` or `$request->only([...])`.

Flag `forceFill()` or `forceCreate()` in controller code — these bypass mass assignment protection and should only appear in seeders or trusted internal services.

## Validation

Verify all controller inputs are validated with Form Request classes or `$request->validate()`. Flag validation rules that use `required` without `sometimes` for update operations — partial updates should not require all fields.

Check for custom validation rules that hit the database without caching — `unique` and `exists` rules trigger queries on every validation. Flag validation messages that expose internal column names or table structures.

Verify file upload validation includes `mimes`, `max` size, and `dimensions` where applicable. Flag file uploads stored in `public/` without randomized filenames.

## Blade Security

Flag `{!! $variable !!}` (unescaped output) on any user-supplied data — this is XSS. Verify `{{ $variable }}` (escaped) is used for all user content. Check that `@csrf` is present in every form. Flag AJAX requests that skip the `X-CSRF-TOKEN` header.

Verify `@auth` and `@can` directives are used for conditional UI rendering — but check that server-side authorization is also enforced (Blade directives are UI-only, not security controls).

## Middleware

Verify authentication middleware is applied at the route group level, not individually on each route (easy to miss one). Flag controllers that check `auth()->user()` without middleware protection — the user could be null.

Check middleware ordering: `auth` before `verified`, `throttle` before expensive operations. Flag middleware that performs database queries on every request — use caching for data that doesn't change per-request.

## Queue and Job Reliability

Verify queued jobs implement `ShouldQueue` and define `$tries` and `$backoff`. Flag jobs without `failed()` method — unhandled job failures are silent. Check that jobs are idempotent — they may be retried after a partial execution.

Flag `dispatch()` calls inside database transactions — if the transaction rolls back, the job still executes with stale data. Use `afterCommit()` or dispatch after the transaction commits.

Verify long-running jobs define `$timeout` to prevent queue worker deadlocks. Flag jobs that hold database connections for extended periods.

## Service Architecture

Flag business logic in controllers — controllers should validate, delegate to services, and return responses. Flag Eloquent queries in Blade templates — all data should be passed from the controller.

Check that repository or service patterns are consistent — flag mixed patterns where some models are queried in controllers and others through repositories. Verify `DB::transaction()` wraps multi-step write operations.

## Configuration and Environment

Flag `env()` calls outside of config files — `env()` returns `null` when config is cached. All environment values should be accessed through `config()` after being registered in config files.

Verify `.env` is in `.gitignore`. Flag hardcoded credentials, API keys, or secrets in config files. Check that `APP_DEBUG=false` and `APP_ENV=production` in production environment.

For each finding, report: the file, the specific Laravel pattern violated, and the recommended fix.
