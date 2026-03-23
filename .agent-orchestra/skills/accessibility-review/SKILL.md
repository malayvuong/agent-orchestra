---
name: Accessibility Review
description: Deep review of web accessibility — WCAG 2.1 compliance, ARIA patterns, keyboard navigation, color contrast, screen reader compatibility, and semantic HTML.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - consistency
  keywords:
    - accessibility
    - a11y
    - wcag
    - aria
    - screen reader
    - keyboard
---

When reviewing web code for accessibility, apply the following WCAG 2.1-based checks.

## Semantic HTML

Verify semantic elements are used instead of generic `div` and `span`: `nav` for navigation, `main` for primary content, `article` for self-contained content, `aside` for supplementary content, `header`/`footer` for page or section headers/footers.

Flag `<div onclick>` where a `<button>` should be used. Flag `<span>` styled as a link where an `<a href>` should be used. Interactive elements must be natively focusable — using `div` with `tabindex="0"` and manual keyboard handling is fragile and incomplete.

Flag heading levels that skip (e.g., `h1` followed by `h3` without `h2`). Verify there is exactly one `h1` per page.

## ARIA Patterns

Flag `aria-label` on elements that already have visible text — this overrides the visible text for screen readers, causing a mismatch. Verify `aria-hidden="true"` is not set on elements that contain focusable children — this creates a trap where keyboard users can focus elements that screen readers cannot see.

Flag `role="button"` on a `<div>` — use a native `<button>` instead. If a custom widget must use ARIA, verify all required ARIA properties are present (e.g., `role="tab"` requires `aria-selected`, `aria-controls`, and associated `role="tabpanel"`).

Check that `aria-live` regions are used for dynamic content updates that screen readers should announce. Flag toast notifications and status messages without `aria-live="polite"` or `role="status"`.

## Keyboard Navigation

Verify all interactive elements are reachable via Tab key in a logical order. Flag `tabindex` values greater than 0 — these override natural tab order and create confusion. Flag elements with `tabindex="-1"` that should be focusable.

Verify modal dialogs trap focus — Tab should cycle within the modal, not escape to the background page. Check that Escape key closes modals, dropdowns, and popups. Verify custom dropdowns and menus support arrow key navigation.

Flag `mouseenter`/`mouseleave` event handlers without corresponding `focus`/`blur` handlers — hover-only interactions are invisible to keyboard users.

## Color and Contrast

Verify text meets WCAG AA contrast ratios: 4.5:1 for normal text, 3:1 for large text (18px+ or 14px+ bold). Flag text on gradient or image backgrounds where contrast cannot be guaranteed.

Flag color as the only means of conveying information — error states, required fields, chart data, and status indicators must have non-color cues (icons, text labels, patterns). Check that focus indicators are visible — flag `outline: none` without a custom visible focus style.

## Images and Media

Verify all `<img>` elements have `alt` attributes. Decorative images should use `alt=""` (empty, not missing). Informative images must have descriptive alt text. Flag alt text that starts with "image of" or "picture of" — describe the content, not the medium.

Verify `<video>` elements have captions or transcripts. Flag auto-playing media without user control to pause or stop. Check that animations respect `prefers-reduced-motion` media query.

## Forms

Verify every form input has an associated `<label>` element (via `for` attribute or wrapping). Flag placeholder text used as the only label — placeholders disappear on input and fail contrast requirements. Verify error messages are programmatically associated with their input (via `aria-describedby`).

Check that form validation errors are announced to screen readers. Flag form submissions that clear the page without moving focus to the result or error summary. Verify required fields are indicated with both visual and programmatic cues (`aria-required="true"` or `required` attribute).

## Touch Targets

Verify interactive elements have a minimum touch target size of 44x44 CSS pixels (WCAG 2.5.5). Flag small icon buttons, close buttons, or links in dense layouts that fail this minimum. Check spacing between adjacent touch targets — overlapping tap areas cause mis-taps.

For each finding, report: the element or component, the WCAG success criterion violated, and the recommended fix.
