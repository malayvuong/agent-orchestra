---
name: unknown-lens-skill
description: A skill with an unrecognized lens value in triggers
version: 2026.3.1
triggers:
  lenses:
    - security
    - not-a-real-lens
    - also-fake
---

This skill has an unknown lens value which should trigger a warning but still parse successfully.
