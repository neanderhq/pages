# Security

Use this repository's **Security → Report a vulnerability** form for private
reports. Include the affected commit, impact and reproduction steps. Never post
workspace data, authentication tokens, provider keys or private attachments in
public issues.

The maintained branch is `main`. Public CI runs complete dependency audits,
dependency review and production-image vulnerability/secret scanning. Weekly
Dependabot updates and extended CodeQL complement app tests. These checks use
read-only repository access and no cloud credentials. A clean scan does not prove
that an application has no vulnerabilities.

Preserve server-side tenant, role and page/space grant checks, mutation Origin
validation, private upload access, invitation expiry and password-reset session
revocation. Initialization must remain explicit and retryable, with generated
credentials and fictional fixtures. Runtime requests must not create demo users
with a fixed password.

The private Neander publisher verifies committed source and scans the actual
tested runtime images before registration, then rescans registered digests daily.
A source update does not update an already published image or a user's app until
it is republished. See [limitations](docs/limitations.md).
