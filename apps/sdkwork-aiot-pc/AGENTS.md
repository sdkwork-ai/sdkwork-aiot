# Repository Guidelines

## SDKWORK Soul

Read `../../../sdkwork-specs/SOUL.md` and the parent `../../AGENTS.md` before executing tasks in this application root.

## SDKWORK Standards

Canonical standards are indexed by `../../../sdkwork-specs/README.md`; agent entrypoint rules come from `../../../sdkwork-specs/AGENTS_SPEC.md`. Reference global standards by relative path and do not copy their normative bodies here.

## Application Identity

Read `sdkwork.app.config.json` when work touches PC application behavior, runtime configuration, SDK wiring, release metadata, packaging, or app-owned capabilities. `etc/` is the concrete source configuration authority. This surface delegates runtime topology to `../../specs/topology.spec.json` through `etc/sdkwork.deployment.config.json#parentTopologySpec`; it must not own a competing topology. Root `../../sdkwork.workflow.json` remains the release authority.

## Local Dictionary Structure

- `AGENTS.md`: nearest application execution entrypoint.
- `sdkwork.app.config.json`: PC application identity and DRAFT release declaration.
- `etc/`: deployable-root source configuration and parent topology delegation.
- `specs/`: application contracts; `specs/component.spec.json` is the machine-readable component authority.
- `packages/`: authored PC application modules.
- `package.json`: application lifecycle and package command manifest.
- `vite.config.ts`: Vite development and build configuration.

## Spec Resolution Order

Use dynamic progressive loading: read this file and `../../AGENTS.md`, then load the app manifest, local `specs/`, and `etc/` only when the current task touches their contract. Locate the relevant row in `../../../sdkwork-specs/README.md`, read only the selected global spec sections, and inspect implementation files last.

## Required Specs By Task Type

- Agent or workflow work: `../../../sdkwork-specs/SOUL.md`, `../../../sdkwork-specs/AGENTS_SPEC.md`, `../../../sdkwork-specs/SDKWORK_WORKSPACE_SPEC.md`, `../../../sdkwork-specs/GITHUB_WORKFLOW_SPEC.md`, and `../../../sdkwork-specs/TEST_SPEC.md`.
- Package commands: `../../../sdkwork-specs/PNPM_SCRIPT_SPEC.md`, `../../../sdkwork-specs/APP_RUNTIME_TOPOLOGY_SPEC.md`, and `../../../sdkwork-specs/TEST_SPEC.md`.
- Source configuration: `../../../sdkwork-specs/SOURCE_CONFIG_SPEC.md`, `../../../sdkwork-specs/CONFIG_SPEC.md`, `../../../sdkwork-specs/ENVIRONMENT_SPEC.md`, and `../../../sdkwork-specs/DEPLOYMENT_SPEC.md`.
- TypeScript or frontend code: `../../../sdkwork-specs/TYPESCRIPT_CODE_SPEC.md`, `../../../sdkwork-specs/FRONTEND_CODE_SPEC.md`, `../../../sdkwork-specs/FRONTEND_SPEC.md`, `../../../sdkwork-specs/UI_ARCHITECTURE_SPEC.md`, and `../../../sdkwork-specs/APP_PC_ARCHITECTURE_SPEC.md`.
- SDK integration: `../../../sdkwork-specs/APP_SDK_INTEGRATION_SPEC.md`, `../../../sdkwork-specs/SDK_SPEC.md`, and `../../../sdkwork-specs/SDK_WORKSPACE_GENERATION_SPEC.md`.
- List/search work: `../../../sdkwork-specs/PAGINATION_SPEC.md` and the owning API, SDK, service, or frontend spec.

Language-specific specs are on-demand; load only the standards for the touched language and framework.

## Code Style Rules

Any code change also loads `../../../sdkwork-specs/CODE_STYLE_SPEC.md` and `../../../sdkwork-specs/NAMING_SPEC.md`. Feature packages consume SDK clients and types through the approved PC core composition surface. Build scripts, dev runners, and `pnpm clean` follow `CODE_STYLE_SPEC.md` section 7; clean must preserve tracked build-critical source.

## Build, Test, and Verification

Run commands from this application root. Public lifecycle commands are `pnpm dev`, `pnpm dev:standalone`, `pnpm dev:cloud`, `pnpm stop`, `pnpm build`, `pnpm test`, `pnpm check`, `pnpm verify`, and `pnpm clean`. Run `node ../../../sdkwork-specs/tools/check-source-config-standard.mjs --root .` for source-config changes, `node ../../../sdkwork-specs/tools/check-app-sdk-consumer-imports.mjs --workspace ../..` for SDK consumer changes, and `node ../../../sdkwork-specs/tools/check-pagination.mjs --workspace ../..` for list/search changes.

## Agent Execution Rules

Keep edits within the owning app or package, do not hand-edit generated SDK transport output, and do not replace composed SDK integration with raw HTTP or manual authorization headers. Record exact verification commands and results. Root packaging, publishing, and deployment authority must not be duplicated here.

## HTTP API Response Envelope

All L2+ SDKWork-owned custom HTTP contracts, including `app-api`, `backend-api`, and SDKWork-owned business `open-api`, `MUST` follow `API_SPEC.md` section 4.5, section 14, and section 15:

- **Default classification:** omitted `x-sdkwork-wire-protocol` means SDKWork-owned custom API (`sdkwork-v3`); only operation-level `x-sdkwork-wire-protocol: external` plus `x-sdkwork-external-protocol-id` identifies a third-party compatibility `open-api` operation.
- **Input:** typed request bodies, section 14.1 list/search/command input, `SdkWorkListQuery`, and `q` for free-text search.
- **Success output:** `SdkWorkApiResponse` with `{ "code": 0, "data": <payload>, "traceId": "<server-uuid>" }`.
- **Error output:** HTTP 4xx/5xx `application/problem+json` (`ProblemDetail`) with numeric `code` and `traceId`; SDKWork-owned errors may include `i18nKey` and `locale` presentation metadata.
- Success `code` is numeric `int32`; HTTP 2xx JSON bodies `MUST` use `0` only. REST semantics remain on HTTP status (`201`, `202`, etc.).
- Platform error codes are numeric non-zero values per section 15.3 (`40001`, `40101`, `40401`, …).
- Single resource: `data.item`
- Lists: `data.items` + `data.pageInfo` (`PageInfo.mode` is `offset` or `cursor`)
- Commands: `data.accepted` plus optional `resourceId` / `status`
- Async accept (`202`): `data.operationId`, `data.status`, optional `pollUrl`
- Operation patterns: retrieve/list/search/create/update/delete/command/async/bulk semantics follow `API_SPEC.md` section 15.4; create uses `201`, delete uses `204` with no JSON body, and `PUT`/`PATCH` use SDK action `update`.

Vendor compatibility `open-api` routes that mirror upstream tool or provider wire (for example OpenAI `/v1/*`, Anthropic/Claude `/anthropic/v1/*`, Google/Gemini `/google/v1beta/*`, Claude Code, or Codex) `MAY` opt out only when every exempt operation declares operation-level `x-sdkwork-wire-protocol: external` and `x-sdkwork-external-protocol-id` per `API_SPEC.md` section 4.5.2. SDKWork-owned business `open-api` operations `MUST NOT` opt out. Mixed OpenAPI documents are validated per operation; one external operation never exempts SDKWork-owned operations in the same document.

Errors `MUST` use HTTP 4xx/5xx with `application/problem+json` (`ProblemDetail`) including required numeric `code` and `traceId`. Optional `i18nKey` and `locale` are display metadata only. Business failures `MUST NOT` use HTTP 2xx with non-zero `code`, string wire codes, `success`, or human `message`.

Forbidden legacy envelopes and fields: `PlusApiResult`, `AppbaseApiResult`, `StoreApiResult`, `SdkWorkResponse`, per-domain `*ApiResult`, wire field `requestId`, bare domain DTOs at the HTTP root, and top-level `{ items, pageInfo, traceId }` without `data`.

Handlers `MUST` serialize success and map errors through `sdkwork-web-framework` response mapping. Generated HTTP SDKs (`--standard-profile sdkwork-v3`) unwrap `data` by default and expose typed numeric `ProblemDetail.code` / `traceId` and returned localization metadata on errors; use `.raw` when the full envelope is required.

Before completing API contract, SDK generation, or frontend service work, run:

```bash
node <sdkwork-specs>/tools/check-api-operation-patterns.mjs --workspace <workspace-root>
node <sdkwork-specs>/tools/check-api-response-envelope.mjs --workspace <workspace-root>
```

Authority: `sdkwork-specs/API_SPEC.md` section 4.5 and sections 14–16, `SDK_SPEC.md` section 4.2, `FRONTEND_SPEC.md`, `MIGRATION_SPEC.md` section 4.2.

## Human Review Rules

Request human review before breaking standards, changing public names, auth/security behavior, database schemas, generated SDK ownership, production release metadata, signing, publishing, upload, deployment apply, or rollback.
