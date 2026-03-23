---
name: Docker Review
description: Deep review of Dockerfiles and Docker Compose — layer caching, image size, security hardening, multi-stage builds, and runtime configuration.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - security
    - performance
  keywords:
    - docker
    - dockerfile
    - container
    - compose
    - image
---

When reviewing Docker configuration, apply the following checks.

## Layer Caching

Verify `COPY` and `ADD` instructions are ordered from least-frequently changed to most-frequently changed. Flag Dockerfiles that copy the entire source tree before installing dependencies — this invalidates the dependency cache on every code change. The correct order is:

1. Copy dependency manifests (`package.json`, `requirements.txt`, `go.mod`)
2. Install dependencies
3. Copy source code
4. Build

Flag `RUN` instructions that combine unrelated operations — each `RUN` creates a layer. Conversely, flag multiple `RUN` instructions for related operations that should be combined with `&&` to reduce layer count and image size.

## Image Size

Flag images based on full OS distributions (`ubuntu`, `debian`) when slim or Alpine variants exist. Verify multi-stage builds are used — the final stage should contain only runtime dependencies, not build tools, compilers, or test frameworks.

Check for files left behind after package installation: `apt-get install` must be followed by `rm -rf /var/lib/apt/lists/*` in the same `RUN` layer. Flag `npm install` without `--omit=dev` or `yarn install --production` in the final stage.

Flag `COPY . .` in the final stage of a multi-stage build — only copy the built artifacts from the builder stage.

## Security

Verify the image does not run as root. Flag missing `USER` instruction — the default is root. Check that a non-root user is created with `RUN addgroup` and `RUN adduser` and that `USER` is set before `CMD`/`ENTRYPOINT`.

Flag `--privileged` in Docker Compose or run commands. Flag `cap_add: ALL` — add only the specific capabilities needed. Verify `read_only: true` is set for containers that do not need to write to the filesystem.

Check that secrets are not embedded in the image: flag `ENV` instructions with API keys, passwords, or tokens. Flag `COPY` of `.env` files into the image. Verify `.dockerignore` excludes `.env`, `.git`, `node_modules`, and other non-essential files.

Flag images that use `latest` tag — pin to specific version tags for reproducibility. Verify base images are from trusted sources (official Docker Hub images or verified publishers).

## Multi-Stage Build Patterns

Verify build stages are named (`AS builder`) for clarity. Check that test stages exist and run before the final production stage. Flag final stages that include test dependencies or development tools.

Verify `COPY --from=builder` copies only the necessary artifacts — not the entire builder filesystem. Flag multi-stage builds where the final stage re-installs dependencies that were already available in the builder stage.

## Runtime Configuration

Verify `HEALTHCHECK` instruction is present for production images. Flag containers without resource limits (`mem_limit`, `cpus`) in Compose files. Check that `restart: unless-stopped` or `restart: always` is set for production services.

Verify `EXPOSE` matches the actual ports the application listens on. Flag `EXPOSE 0.0.0.0:PORT` syntax — `EXPOSE` documents the container port, host binding happens at runtime.

Check that log output goes to stdout/stderr (not to files inside the container) so Docker's logging driver can capture it.

## Docker Compose

Verify services define `depends_on` with health check conditions when service startup order matters. Flag Compose files that mount the host Docker socket (`/var/run/docker.sock`) without justification — this gives the container full control of the host Docker daemon.

Check that named volumes are used for persistent data — not bind mounts to host paths that may not exist. Verify network configuration isolates services that should not communicate directly.

For each finding, report: the file and line, the Docker-specific pattern violated, and the recommended fix.
