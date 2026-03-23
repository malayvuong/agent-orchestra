---
name: Git Workflow Review
description: Deep review of Git practices — PR quality, commit hygiene, branch strategy, merge patterns, and collaboration anti-patterns that affect team velocity.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - logic
    - consistency
  keywords:
    - git
    - pr
    - pull request
    - commit
    - branch
    - merge
    - review
---

When reviewing Git workflow and PR practices, apply the following checks.

## PR Size and Scope

Flag PRs with more than 400 lines of changes — large PRs get rubber-stamped, not reviewed. Verify each PR has a single purpose: one feature, one bug fix, or one refactor. Flag PRs that bundle unrelated changes ("fixed the login bug and also reformatted all CSS files").

Flag PRs without a description explaining what changed and why. Check that the PR description links to the relevant issue or ticket. Verify the PR title is descriptive enough to understand the change from the commit log.

## Commit Hygiene

Flag commits with messages like "fix", "wip", "update", "changes", "asdf" — each commit message should explain what and why. Verify the repository follows a consistent commit message convention (Conventional Commits, Gitmoji, or team-specific).

Flag commits that mix functional changes with formatting, renaming, or refactoring — separate them into distinct commits so the functional change can be reviewed without noise. Check that each commit compiles and passes tests — flag commits that break the build when checked out individually.

Flag large "squash everything" commits that lose the development history. Flag unsquashed "fix review comments" commits that clutter the history — squash fixup commits before merging.

## Branch Strategy

Verify the repository has branch protection rules on the default branch. Flag force pushes to `main`/`master`. Check that PRs are required before merging to the default branch — direct commits bypass code review.

Flag long-lived feature branches (> 2 weeks without merge) — these create painful merge conflicts. Verify feature branches are rebased or merged from the default branch regularly to stay current.

Flag branches that are merged but not deleted — stale branches clutter the repository. Verify the repository uses a consistent naming convention for branches (`feature/`, `fix/`, `chore/`, or issue-number-based).

## Merge Patterns

Verify the team has a consistent merge strategy (squash-and-merge, rebase-and-merge, or merge commits) — not mixed randomly. Flag merge commits that import unrelated changes from the target branch into the feature branch history.

Flag `git merge --no-ff` when `--squash` is the team convention (or vice versa). Check that CI status checks are required before merge — flag repositories where PRs can be merged with failing CI.

## Sensitive Data

Flag commits that add secrets, API keys, credentials, or `.env` files to the repository — even if removed in a later commit, the secret persists in Git history. Check `.gitignore` for common sensitive patterns: `.env`, `*.pem`, `*.key`, `credentials.json`, `secrets.yaml`.

Flag `.gitignore` entries that are added after the files have already been committed — the files remain in history. Verify `git-secrets` or equivalent pre-commit hooks are configured to prevent accidental secret commits.

## Code Review Practices

Flag PRs approved without comments on a large change — this suggests rubber-stamping. Flag PRs with a single reviewer on critical paths (authentication, payments, infrastructure). Verify CODEOWNERS is configured for sensitive directories.

Flag self-merged PRs (author merges without another reviewer's approval) on protected code. Check that review comments are resolved before merge — not just acknowledged and ignored.

## Repository Configuration

Verify `.gitattributes` handles line endings consistently for cross-platform teams. Flag repositories without a `.editorconfig` when the team uses multiple editors. Check that binary files (images, compiled assets) use Git LFS when they are large or frequently updated.

For each finding, report: the specific Git practice issue, the impact on team velocity or code quality, and the recommended improvement.
