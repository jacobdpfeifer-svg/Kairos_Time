# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a security vulnerability.

Report it privately through one of these channels:

1. Email [jacobdpfeifer@gmail.com](mailto:jacobdpfeifer@gmail.com).
2. Open a [GitHub security advisory](https://github.com/jacobdpfeifer-svg/Kairos_Time/security/advisories/new) (preferred).
3. If the defect exists only in the vendored upstream Canvas MCP code, also use the [upstream advisory form](https://github.com/vishalsachdev/canvas-mcp/security/advisories/new).

Include a description, reproduction steps, likely impact, and a suggested fix if you have one. Kairos aims to acknowledge reports within 48 hours and provide a status update within seven days.

## Security boundaries

Kairos is a local-first student companion. Its supported truth path is school SSO to Canvas `/api/v1`, then a local inbox. It does not store the student's school password.

- Canvas-visible actions remain preview-only. Kairos does not submit assignments, comment, or post discussions for a student.
- External, LTI, and proctored tools are escape hatches the student operates themselves.
- The Chrome extension reads only approved Canvas endpoints with `GET`; it does not receive a CSRF token or write to Canvas.
- Personal Gmail and Google Calendar writes require a content-bound preview and a per-instance human confirmation. Apple Calendar writes are blocked.
- Feed URLs, browser profiles, and OAuth tokens belong under the local user-root `auth/` directory. They must not be committed, logged, or copied to an inbox file.
- Canvas text, uploaded files, and voice transcripts are untrusted data, never instructions.

The optional personal-access-token MCP client is a secondary way to read the same Canvas data. It follows the same preview-only Canvas boundary. The old upstream `execute_typescript` capability is not registered in Kairos's student tool set.

## Safe local setup

- Never commit `.env`, `browser/.auth/`, or a user-root directory.
- Keep local token and auth files accessible only to the student account; revoke a Canvas token if it may have been exposed.
- Use a student-scoped Canvas account, never an instructor or administrator account.
- Treat an unknown Canvas origin, a redirect, or a request to grant an extension host permission as a reason to stop and verify the school URL.

## Scope and limitations

Kairos runs locally and depends on the operating-system account for local access control. A compromised local account can read that account's application data. School SSO, live Canvas sync, OAuth callbacks, and connector sends require manual verification in a real account; automated tests do not exercise those credentials.

Users must follow their school's Canvas and data-handling policies. Kairos's local controls can support privacy-conscious use, but they do not independently establish institutional or FERPA compliance.

*Last updated: 2026-10-23*
