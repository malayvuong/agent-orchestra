---
name: Django Review
description: Deep review of Django applications — ORM query efficiency, middleware ordering, template security, form validation, and authentication patterns.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - security
    - performance
  keywords:
    - django
    - orm
    - queryset
    - middleware
    - django rest framework
---

When reviewing Django code, apply the following framework-specific checks.

## ORM N+1 Queries

For every view that iterates over a QuerySet and accesses related objects, verify `select_related()` (foreign keys, one-to-one) or `prefetch_related()` (many-to-many, reverse foreign keys) is used. Flag template loops that trigger lazy-loaded queries per iteration — each `.related_field` access without prefetching is a separate database round-trip.

Check for QuerySets evaluated multiple times — `queryset.count()` followed by iteration triggers two queries. Flag `list(queryset)` conversions that defeat lazy evaluation benefits. Verify `.only()` or `.defer()` is used when only a subset of fields is needed.

## Migration Safety

Flag migrations that add non-nullable columns without defaults on tables with existing data — this locks the table and fails. Verify `AddField` with `null=True` is used first, followed by a data migration, then `AlterField` to set `null=False`.

Check for `RunPython` migrations that load all rows into memory. Flag migrations that depend on model code that may change in future migrations — use `apps.get_model()` instead of importing models directly.

Verify migrations are reversible — every `RunPython` should have a `reverse_code` parameter. Flag `ALTER TABLE` in raw SQL migrations without a corresponding reverse statement.

## Template Security

Verify `{% autoescape %}` is enabled (it is by default). Flag uses of `|safe` filter or `mark_safe()` on user-supplied data — these bypass XSS protection. Check that `{% csrf_token %}` is present in every POST form. Flag AJAX calls that skip the CSRF token header.

Check that template variables containing HTML are escaped at the point of output, not at the point of storage. Flag `{{ variable|safe }}` where `variable` originates from user input at any point in the data flow.

## Authentication and Authorization

Verify `@login_required` or `LoginRequiredMixin` is applied to every view that should be protected. Flag views that check `request.user.is_authenticated` but still execute logic for unauthenticated users before the check.

Check permission decorators: `@permission_required` should use the correct permission string. Flag views that check `request.user.is_superuser` for authorization — use the permission system instead. Verify object-level permissions are checked when the view modifies or deletes specific objects.

## Form and Serializer Validation

Verify `form.is_valid()` is always called before accessing `form.cleaned_data`. Flag direct access to `request.POST` or `request.GET` without form validation. Check that custom form `clean_*` methods raise `ValidationError` with user-friendly messages.

For Django REST Framework: verify serializers validate all input fields. Flag `serializer.save()` calls without checking `serializer.is_valid(raise_exception=True)`. Check that `ModelSerializer` uses `fields` or `exclude` explicitly — never `fields = '__all__'` on models with sensitive fields.

## Settings Security

Flag `DEBUG = True` in any settings file used for production. Verify `SECRET_KEY` is loaded from an environment variable, not hardcoded. Check that `ALLOWED_HOSTS` is set to specific domains — not `['*']`.

Verify `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE` are `True` for production. Flag missing `SECURE_HSTS_SECONDS` setting.

## Middleware Ordering

Verify `SecurityMiddleware` is first. Check that `SessionMiddleware` comes before `AuthenticationMiddleware`. Flag `CorsMiddleware` placed after middleware that reads the response — it must be near the top to set headers on all responses.

For each finding, report: the file, the Django-specific pattern violated, and the recommended fix.
