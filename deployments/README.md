# Deployments

Deployment manifests, environment bundles, and release handoff artifacts for the SDKWork AIoT server.

- Topology profile env files live under `etc/topology/`.
- Runtime topology contract: `specs/topology.spec.json`
- Human-readable guide: `docs/topology-standard.md`
- GitHub packaging workflow: `agent.workflow.json` and `.github/workflows/package.yml`

Production server binaries are packaged through the `server` profile in `agent.workflow.json`.
