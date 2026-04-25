# Release Process

## Policy

- `main` is the release branch.
- Releases are created from annotated tags in strict SemVer format:
  `vMAJOR.MINOR.PATCH`.
- Pushing a matching tag auto-runs release verification and auto-publishes a
  GitHub Release with generated notes.

## Preconditions

Run full local verification before cutting a tag:

```bash
pnpm precommit
```

If Docker is unavailable, run:

```bash
pnpm precommit:fast
```

In fast mode, database-backed checks are skipped. Use this only when needed.

## Standard Release Flow

1. Make sure local `main` is current.

   ```bash
   git checkout main
   git pull --ff-only
   ```

2. Choose the next version according to SemVer.

3. Create an annotated tag at the release commit on `main`.

   ```bash
   git tag -a vX.Y.Z -m "release: vX.Y.Z"
   ```

4. Push the tag.

   ```bash
   git push origin vX.Y.Z
   ```

5. Wait for `.github/workflows/release.yml` to finish.

6. Confirm the GitHub Release is published with generated notes.

## Hotfix Release Flow

1. Branch from `main`.

   ```bash
   git checkout main
   git pull --ff-only
   git checkout -b fix/<topic>
   ```

2. Implement and validate the fix.

3. Open a pull request to `main` and merge after checks pass.

4. From updated `main`, cut and push the next patch tag (`vX.Y.(Z+1)`).

## Guardrails

- Do not tag non-`main` commits for official releases.
- Do not use non-SemVer tags for release publishing.
- Keep pull request titles and labels accurate so generated notes stay useful.

## Rollback

If a bad release is published:

1. Create a hotfix pull request from `main`.
2. Merge the fix into `main`.
3. Publish a new patch release tag.

Do not rewrite or force-move existing release tags.
