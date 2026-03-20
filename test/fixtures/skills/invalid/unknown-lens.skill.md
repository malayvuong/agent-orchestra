---
name: unknown-lens-skill
description: A skill with an unrecognized lens value in triggers
version: 1.0.0
triggers:
  lenses:
    - security
    - not-a-real-lens
    - also-fake
---

This skill has an unknown lens value which should trigger a warning but still parse successfully.
