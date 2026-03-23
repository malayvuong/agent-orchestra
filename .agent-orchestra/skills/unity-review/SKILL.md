---
name: Unity Review
description: Deep review of Unity C# code — object pooling, Update allocation, physics patterns, UI performance, serialization, and mobile optimization.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - performance
    - logic
  keywords:
    - unity
    - monobehaviour
    - update
    - gameobject
    - c#
    - mobile
---

When reviewing Unity C# code, apply the following engine-specific checks.

## Per-Frame Allocation

Flag any `new` allocation inside `Update()`, `FixedUpdate()`, `LateUpdate()`, or coroutine bodies. This includes: `new List<T>()`, `new Vector3()` (struct boxing in certain contexts), string concatenation with `+`, LINQ queries (`.Where()`, `.Select()`, `.ToList()`), lambda captures that allocate closure objects.

Verify reusable buffers are declared as fields, cleared, and refilled each frame. Check for `GetComponent<T>()` calls in per-frame code — these should be cached in `Awake()` or `Start()`.

Flag `Debug.Log()` in per-frame code — strip or guard with `#if UNITY_EDITOR`.

## Object Pooling

Verify frequently spawned objects (enemies, projectiles, effects, drops) use `ObjectPool<T>` or equivalent. Flag `Object.Instantiate()` and `Object.Destroy()` in gameplay code paths. Check that pooled objects reset state completely on return (position, health, velocity, timers, active components).

Verify pool warm-up (pre-instantiation) occurs during loading, not during gameplay. Flag pools with no maximum size cap — unbounded pools can exhaust memory.

## FindObject Anti-Patterns

Flag all uses of `FindObjectsByType`, `FindObjectOfType`, `GameObject.Find`, `GameObject.FindWithTag` in per-frame or frequently-called code. These perform full scene searches. Verify the static registry pattern is used: objects register in `OnEnable`, unregister in `OnDisable`, and consumers query the registry.

## Physics2D / Physics

Verify `Physics2D.autoSyncTransforms` is `false` and `Physics2D.reuseCollisionCallbacks` is `true`. Flag `PolygonCollider2D` on dynamic objects — use `CircleCollider2D` or `BoxCollider2D`.

Check Layer Collision Matrix — only layers that need to collide should be enabled. Flag raycasts without distance limits (`Physics2D.Raycast` without `maxDistance`). Verify `ContactFilter2D` is reused rather than created per call.

Flag `OnCollisionEnter2D` / `OnTriggerEnter2D` callbacks that allocate or perform expensive logic — these can fire multiple times per physics step.

## Coroutine Patterns

Flag `yield return new WaitForSeconds()` — the `new` allocates every time. Use cached `WaitForSeconds` fields. Flag coroutines that run indefinitely without stop conditions. Verify `StopCoroutine` is called on object disable or destroy to prevent orphaned coroutines.

Check for coroutines used where `async/await` with `UniTask` or native C# `Task` would be cleaner (one-shot async operations vs. frame-by-frame iteration).

## UI Performance

Verify `raycastTarget` is disabled on all non-interactive UI elements (labels, backgrounds, decorative images). Flag unnecessary Canvas rebuilds caused by modifying text or image properties every frame. Check that UI updates are throttled with frame-skip patterns (`if (Time.frameCount % N == 0)`) for non-critical displays (score, timer, debug HUD).

Flag `Canvas.ForceUpdateCanvases()` in per-frame code. Verify UI elements that change frequently are on a separate Canvas from static UI to minimize rebuild scope.

## SerializeField and Inspector

Verify `[SerializeField] private` is used instead of `public` for inspector-exposed fields. Flag public fields that should be private with `[SerializeField]`. Check for `[HideInInspector]` on fields that are set programmatically and should not be accidentally edited in the inspector.

Flag `[SerializeField]` on `MonoBehaviour` references that are set via `GetComponent` in code — these create confusing dual assignment paths.

## ScriptableObject and Data

Verify game configuration uses `ScriptableObject` assets or JSON data rather than hardcoded values in MonoBehaviours. Flag magic numbers in gameplay code (damage values, cooldown durations, spawn rates) that should be data-driven.

Check that `ScriptableObject` instances are not modified at runtime — runtime modifications persist in the editor and corrupt the asset.

## Mobile-Specific

Flag texture settings with `Read/Write Enabled = true` on textures that are not accessed from scripts — this doubles memory usage. Verify sprite atlases are used for UI and gameplay sprites. Check that `Application.targetFrameRate` is set explicitly (typically 30 or 60 for mobile).

For each finding, report: the script name, the specific Unity pattern violated, and the recommended fix.
