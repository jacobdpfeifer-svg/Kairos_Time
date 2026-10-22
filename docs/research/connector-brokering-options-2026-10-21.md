# Connector brokering options — 21 Oct 2026

Research only. This note does not add a connector, a registry entry, a plugin, or a network call. A tool a student names stays a local `requested` or `not_available` record. See [`generative-workspace-architecture-2026-10-21.md`](../handoff/generative-workspace-architecture-2026-10-21.md) §10.

Checked from each project's own GitHub repo on 21 Oct 2026: the repository API (`license.spdx_id`, `default_branch`, `pushed_at`) and the `README.md` / `LICENSE` on that default branch. The survey behind architecture §10 was not used as evidence.

## The decision this has to clear

[`hosting-decision-criteria-2026-09-30.md`](../handoff/hosting-decision-criteria-2026-09-30.md) still says the brain stays on the student's Mac (option A). Nothing leaves the machine except Canvas requests the student's own browser makes. Option B would host only a feed watcher. Option C would host triage, and with it announcements, due dates, grades, and the profile. Changing that answer is a signed addendum, not a side effect of wanting Notion.

Brokering per-student OAuth is a further hosting question. A gateway that holds tokens is not option B, and it is not option C either. It would be a new custody decision: third-party credentials, and whatever those tools return, living somewhere other than the Mac. The same doc already requires, before any hosting, per-student auth, an encrypted store, export and delete, a CU data-handling review, a privacy policy, and an incident plan. Those gates are unmet. There is no beta readout yet that would move option A.

Kairos already has the shape that matches option A. `CONNECTOR_REGISTRY` is a static reviewed list. Personal Google Calendar and Outlook sign-in stay on this Mac, behind a per-use confirmation. Missing tools are written to `{user_root}/inbox/tool-gaps.md` and shown in Settings. That path does not fetch or install anything.

## What was compared

For each project: can a student's credentials stay off a server Kairos operates, is the tool catalog a list someone reviews rather than an open directory, what would break "the brain stays local", the licence on the default branch, and whether the repo is still moving.

| Project | Repo | Licence on the default branch | Last push (`pushed_at`) |
|---|---|---|---|
| IBM ContextForge | [IBM/mcp-context-forge](https://github.com/IBM/mcp-context-forge) `main` | Apache-2.0 | 2026-10-21T17:00:09Z |
| Obot | [obot-platform/obot](https://github.com/obot-platform/obot) `main` | MIT | 2026-10-21T22:20:07Z |
| Docker MCP Gateway | [docker/mcp-gateway](https://github.com/docker/mcp-gateway) `main` | MIT | 2026-10-21T14:19:29Z |
| Docker MCP catalog | [docker/mcp-registry](https://github.com/docker/mcp-registry) `main` | MIT | 2026-10-21T05:13:51Z |
| MCP Gateway & Registry | [agentic-community/mcp-gateway-registry](https://github.com/agentic-community/mcp-gateway-registry) `main` | Apache-2.0 | 2026-10-22T02:20:47Z |
| Composio | [ComposioHQ/composio](https://github.com/ComposioHQ/composio) `next` | MIT (SDK; copyright Sampark Inc.) | 2026-10-22T00:55:58Z |
| Official MCP registry | [modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry) `main` | GitHub reports `NOASSERTION`. The `LICENSE` file says the project is moving from MIT to Apache-2.0, and contributions whose authors have not agreed stay MIT | 2026-10-21T23:34:27Z |

The official registry and the Docker catalog are included because they are the closer fit for a directory, and they still do not justify a broker. Every repo above was pushed the day this note was written or the next UTC day. Abandonment is not the reason to wait.

### IBM ContextForge

A gateway and registry you deploy (PyPI, Docker, Compose, Kubernetes, or a cloud). The README describes user-scoped OAuth tokens and an `AUTH_ENCRYPTION_SECRET` used to encrypt stored credentials. Servers are registered through an admin API. The quick start POSTs a local MCP server into the gateway.

Credentials stay off a Kairos server only if that gateway runs on the student's Mac and Kairos never receives the stored tokens. A Kairos-operated gateway is a credential store. The catalog is whoever has the admin token, so it is reviewable only if Kairos freezes the registry and refuses further registration. Shipping it means a database, an admin UI, JWT auth, and a proxy in front of tools. Tool traffic and tokens then sit in that process. If the process is not on the Mac, Canvas-derived context that a tool needed would leave with the call. That is a hosting change under the criteria doc, and the criteria doc has not authorized it.

Apache-2.0 is a licence Kairos can read. The maintenance signal is strong (IBM, thousands of stars, pushed the day of this note) and that is also the cost: this is an enterprise gateway, not a ten-line allowlist.

### Obot

The README describes a governance platform: LLM gateway, hosted MCP servers, shared credentials, Kubernetes secret bindings, and provider credentials kept in Obot so they are not handed to each client. Clients authenticate to Obot.

That design puts credentials in the platform. If Kairos ran Obot, the tokens would be on a Kairos server. The catalog is an organizational inventory, not a list reviewed in a Kairos pull request. Model calls are part of the product (provider keys, model access policies, recorded requests). Using it for connectors would move the brain, not only the tools. MIT on the repo does not change where the tokens live.

It is active. It is the wrong shape for one student on one Mac.

### Docker MCP Gateway and its catalog

`docker/mcp-gateway` is the `docker mcp` CLI plugin behind Docker Desktop's MCP Toolkit. Servers from the catalog run as containers. The README says secrets stay in Docker Desktop's secret store rather than in environment variables, and that the gateway can run OAuth for servers that need it. `docker/mcp-registry` is the catalog those servers come from. Its README says entries are reviewed, signed when Docker builds the image, and added by pull request. Anyone can submit a server.

Credentials can stay off a Kairos server: they would sit in Docker Desktop on the student's Mac. Kairos would still not hold them. The catalog is reviewed by Docker, not by Kairos, and it is a public directory of servers. A reviewed public directory is still open-ended relative to `CONNECTOR_REGISTRY`. Dynamic discovery is a feature of the gateway. Kairos would have to pin a subset and refuse the rest, which is the registry it already has, plus Docker Desktop as a dependency.

What breaks the local promise: installing and running third-party servers because a student named them, and any path that sends tool arguments or results off the Mac. Container isolation does not review a server against the Canvas-focus rules (no submit, no comment, no discussion post, no Bucket B automation). The licence (MIT on both repos) is fine. Both repos moved on 21 Oct 2026. The fit is still a developer toolkit, not a student app with a frozen connector list.

### agentic-community MCP Gateway & Registry

Apache-2.0. The README calls it one governed control plane for MCP servers, agents, and skills, running on Kubernetes (EKS), ECS, or Docker Compose on EC2, with OAuth (Keycloak or Entra) and an audit trail. Discovery includes natural-language search. Registration is how a server gets in.

Self-hosting means the credentials live on whatever cluster runs the gateway. That can be off a Kairos server. It is still a server, with an identity provider, and it is built for an organization. The catalog is whatever the organization registers. Tool calls go through the gateway, so a Kairos-hosted or school-hosted deployment sees the call. A copy on the student's Mac would keep the bytes local and would also mean running a control plane for a single user. The project is active (pushed 22 Oct 2026 UTC). Activity does not make Keycloak a reasonable dependency for Settings → Connectors.

### Composio

The SDK repo's default branch is `next`. The licence file there is MIT, copyright Sampark Inc. The README tells you to create an API key in the Composio dashboard and open a session so an agent can act across 1000+ toolkits. Authentication is the service. This note did not find a self-host path in that README.

Credentials live at Composio. The catalog is their toolkit list, not a Kairos review. A tool call is a call to their cloud, so the brain is no longer local the moment a student's context is sent there to use a tool. The hosting criteria doc's option A forbids that, and option C's preconditions (custody, deletion, a data-handling review, a privacy policy) are not met. A hosted broker also cannot promise that a Canvas submit tool stays preview-only, because the catalog is not Kairos's.

MIT on the SDK is the licence for the client. The broker is the hosted product.

### Official MCP registry

Included because a directory maintained beside the protocol is the obvious "something better" if the job is discovery. [modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry) is that directory: an app-store-style list of MCP servers, with a live API. It does not hold a student's OAuth tokens. Publishing is how a server gets listed.

The `LICENSE` file says the project is moving from MIT to Apache-2.0, and that work whose authors have not agreed to the move stays MIT. GitHub's API reports `NOASSERTION` for that reason. Treat the licence as mixed until the transition finishes.

Using the live registry as an installer would fetch and run code a student mentioned. That is the rule `plugins/README.md` already forbids. A local mirror Kairos curated by hand is `CONNECTOR_REGISTRY` again. The registry is active. It is a catalog of other people's servers, not a reason to broker OAuth.

## Recommendation

Wait. Do not broker, and do not vendor a gateway.

Licence and activity are not the obstacle. Every project above moved this week, and the licences that are settled (Apache-2.0 or MIT) are ones the repo can read. The obstacle is the hosting decision. Option A is still the signed answer. A broker that Kairos operates would hold tokens the criteria doc has not agreed to hold. A broker the student operates would be a second product on the Mac (Docker Desktop, or a gateway plus a database and an identity provider) in order to do what a reviewed plugin and the existing Calendar and Outlook sign-in already do for the few tools Kairos is willing to touch.

The official registry and the Docker catalog are the best of the directory ideas, and both are still someone else's open list. Kairos's list has to stay the one a maintainer merges.

Reopen this note only when all three of these are true:

1. [`hosting-decision-criteria-2026-09-30.md`](../handoff/hosting-decision-criteria-2026-09-30.md) has a signed addendum that leaves option A. Brokering is not covered by option B or option C as written. The addendum would have to say that third-party tokens may leave the Mac, or that a local gateway is in scope, and it would have to carry the custody, deletion, and review requirements that doc already lists for hosting.
2. A connector that has already been reviewed into `CONNECTOR_REGISTRY` needs per-student OAuth that cannot live in the local browser profile the way Calendar and Outlook do today.
3. The gateway that would hold the token runs on the student's Mac, so a Kairos server never sees it. Of the projects above, the Docker MCP Gateway is the only one whose own README puts secrets in a per-machine store. Even then, Kairos would pin an allowlist and refuse the public catalog. An open directory, or Composio's hosted toolkits, would still be out.

Until those three are true, a named tool stays a row in Settings and a row in `tool-gaps.md`.
