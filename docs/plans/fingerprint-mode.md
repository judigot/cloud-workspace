# Journey 0 on a fresh EC2 host with phone approval

**Proposal for Jude.** Give the instance its own AWS identity. Let Jude separately authorize GitHub and T3 Connect from the phone. Success means a fresh Ubuntu host reaches T3 from the phone without anyone entering a password, PAT, AWS access key or vault secret. GitHub still asks the operator to transfer a short-lived device code. This assumes an enrolled phone and an existing passwordless route into the initial Ubuntu shell, such as an already-unlocked local SSH agent. Terraform provisioning and initial Infisical enrollment happen from a trusted administrator session.

## Current and proposed flow

| Stage | README on main | One-shot branch | Fingerprint mode |
|---|---|---|---|
| Host tools | Load devrc, initialize Ubuntu and Node | Same steps in the outer README block | Use reviewed, pinned bootstrap inputs and install gh, AWS CLI and Infisical CLI |
| GitHub | installgithub installs gh, usessh provisions SSH access, then probe and clone | Same auth outside the script. ensure_workspace accepts either origin but probes and clones over SSH | Authorize gh over HTTPS on the phone, configure its Git helper, then probe and clone over HTTPS |
| AWS and secrets | installaws and authaws use the Bitwarden-backed devrc flow | Same, followed by clearing BW_SESSION | Verify the instance role, exchange its signed AWS identity for a short-lived Infisical token, inject only the consuming process's secrets |
| T3 | Install CLI and run t3 up with Connect and no LAN exposure | Script handles real TTY, headless startup, linger, older CLI fallbacks and status | Retain the one-shot startup and explicit phone approval. T3 itself needs no application secret bundle |

Baselines reviewed include the [main journey](../../README.md), [one-shot README](https://github.com/judigot/cloud-workspace/blob/b169574/README.md), [one-shot script](https://github.com/judigot/cloud-workspace/blob/b169574/scripts/ec2-t3-bootstrap.sh), [infra blueprint](https://github.com/judigot/infra/tree/860db03/blueprints/app/aws) and [devrc](https://github.com/judigot/user/blob/ff36048/.devrc).

## Rollout by repository

### 1. judigot/infra and Infisical enrollment

1. In blueprints/app/aws/70-security-iam.tf (currently a placeholder), create an opt-in workspace role trusted only by the EC2 service principal for sts:AssumeRole, and an instance profile containing that role. Start with zero attached permissions policies. AWS identity proof uses signed GetCallerIdentity, which requires no allow policy. Add individually justified actions and resource ARNs only for identified workloads. Scope the provisioning principal's iam:PassRole to this role and EC2.
2. Pass the profile **name** through 20-core-compute-ec2.tf to a nullable input on modules/aws/compute-ec2, then set aws_instance.this.iam_instance_profile. Preserve the existing IMDSv2 requirement and encrypted root volume. Output the role ARN for enrollment. Review Terraform plans with the feature enabled and disabled before applying to a disposable instance. [EC2 module](https://github.com/judigot/infra/blob/860db03/modules/aws/compute-ec2/main.tf) · [STS identity permissions](https://docs.aws.amazon.com/STS/latest/APIReference/API_GetCallerIdentity.html)
3. In an Infisical Cloud Free organization, verify AWS Auth, identity allowance and effective project permissions with a disposable project first. Create a machine identity with AWS Auth bound to the exact IAM **role ARN**, without an account-wide match or alternate client secret. Give it read access to the workspace's development secrets only. Use a dedicated project if the tier cannot enforce the required path isolation. Configure a short token TTL. Record the regional API endpoint, identity ID, project ID, environment slug and path as nonsecret bootstrap inputs. Seed workload secrets through the administrator session. Keep values out of Terraform variables, state and user data. [AWS Auth](https://infisical.com/docs/documentation/platform/identities/aws-auth) · [Cloud plan limits](https://infisical.com/pricing)

### 2. judigot/user devrc

1. Keep installGitHub (installgithub) installation-only. Add a separate HTTPS authorization function. Check the expected gh account first and, when authorization is needed, run `gh auth login --hostname github.com --git-protocol https --web` as ubuntu with a TTY. On the phone, open github.com/login/device, paste the displayed code, review the account and scopes, and authorize. Use GitHub Mobile approval with fingerprint when challenged. A signed-in browser may complete authorization directly. Verify the actual prompts on Jude's enrolled phone. Finish with `gh auth setup-git --hostname github.com`. Check a private repo the account should read, since a public probe also succeeds anonymously. [gh login and credential storage](https://cli.github.com/manual/gh_auth_login) · [Git helper](https://cli.github.com/manual/gh_auth_setup-git) · [Device authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)
2. Keep installaws for CLI installation. Add a role-verification function alongside useAWS (authaws). Reject overriding AWS credentials or profiles and verify the expected account and assumed-role ARN with aws sts get-caller-identity. On failure report the missing or unexpected profile and stop. Leave useSSH/usessh and authaws available for explicit legacy use. Register new names in ALIAS and document both entry points.
3. Add a scoped runner that obtains an Infisical token for each invocation. Illustrative contract for a pinned CLI, inside a non-traced subshell with the Cloud endpoint configured for both commands:

   ~~~bash
   token="$(infisical login --method=aws-iam --machine-identity-id="$IDENTITY_ID" --silent --plain)" || exit 1
   test -n "$token" || exit 1
   INFISICAL_TOKEN="$token" infisical run --projectId="$PROJECT_ID" --env="$ENV_SLUG" --path="$SECRET_PATH" -- "$@"
   ~~~

   Confirm flags and IMDSv2 support on the selected release. Invoke only for commands that consume secrets. A service should authenticate again on each start, including reboot, and restart to pick up rotated values. Never export tokens into the login shell, generate .env files or source shell fragments from a vault. Bitwarden stays on personal devices for personal passwords.

### 3. judigot/cloud-workspace

1. Base implementation on the one-shot change once integrated, or port its reviewed script first. Add an explicit fingerprint mode to the README entry block. Select it before any usessh/authaws call. Run role verification first, check a scoped Infisical canary without displaying its value, authorize gh, then invoke the bootstrap with its TTY available.
2. Have ensure_workspace select HTTPS for both the fresh probe and clone, retaining CW_REF and the existing directory guards. For a recognized preexisting SSH checkout, offer an explicit origin conversion after HTTPS access succeeds. Preserve local changes, branch and unrelated remotes. Update the SSH-only guidance in agents/create-app.md for this mode.
3. Run the existing T3 Connect pairing path and check service and Connect status plus an actual phone connection after logout and reboot. Keep pairing URLs/codes out of persistent logs. Journey 0 stops here. Later dashboard/init/nginx journeys read or generate .env today and need their own migration before being advertised as compatible.

## Migration, recovery and security

Pilot on a new instance alongside the working host. Run twice, then reboot. Confirm the same checkout survives, HTTPS Git works, the intended secret can be consumed and an unrelated project is denied. Test a wrong role, an expired token and cancelled phone approval. Each failure should name the failing stage and allow a retry without silently entering a legacy credential prompt. Check for credential files, shell history and log leaks without printing values. Rehearse service restart during an Infisical outage. Report dependency failure and retry with backoff after recovery.

Treat access to IMDS as access to the instance identity. Restrict metadata access from untrusted workloads and isolate them on separate hosts where necessary. A process environment is readable by sufficiently privileged processes. Limit child scope, disable tracing and core dumps for secret consumers, and strip INFISICAL_TOKEN from the workload environment if inherited. Headless gh may save its OAuth token in plaintext in hosts.yml when a keyring is unavailable. Verify storage before approval, agree the storage policy with Jude, and test it across reboot. A phone fingerprint approves enrollment; subsequent Git operations use the stored token.

If the pilot fails, keep the old host serving, repair the profile or provider binding, or retry a fresh device code. Use an explicitly selected SSH Git route if HTTPS approval is unavailable. For loss of phone, recover the GitHub/T3 accounts from a trusted device and re-pair. For suspected host compromise, revoke GitHub authorization and T3 pairing, disable the Infisical identity and invalidate outstanding sessions, isolate the instance and rotate exposed workload secrets. After successful cutover, retire legacy AWS keys and SSH grants after checking other consumers. Avoid copying legacy credentials onto the pilot.

## Alternatives

Ratings weigh fresh-host friction, host credential exposure and recovery effort for Jude's single-user workflow.

**Instance role + Infisical Cloud + GitHub HTTPS device flow (preferred)**

★★★★★

One role binding removes two vault unlocks. Human approval remains visible, with a reusable gh token on the host and an external secret service to operate against.

**Same role and Infisical, with a per-host GitHub SSH key**

★★★★☆

A repo-scoped deploy key can narrow Git access. Each replacement needs key generation, public-key registration and revocation. SSH alone does not authenticate gh API operations. Agent forwarding avoids a resident private key but requires a connected trusted client.

**Instance role + AWS Secrets Manager + GitHub device flow**

★★★★☆

Removes the separate identity exchange. Requires secret-specific GetSecretValue grants, possible KMS permissions, a different injection wrapper and an AWS cost review. Good fallback if Cloud Free cannot enforce the required scope.

**Legacy Bitwarden-backed AWS and SSH bootstrap**

★★☆☆☆

Already documented and useful on the old host during rollback. Unlocking a personal vault on each new workspace and provisioning reusable credentials misses the fresh-host goal.

## Decisions for Jude

- Which AWS account, region and workspace role name identify the pilot? Which AWS actions beyond proving identity are actually needed?
- Which Cloud region, project, environment and first secret consumer should the canary represent? If Free lacks the required controls, is a dedicated project sufficient or should the pilot use AWS Secrets Manager?
- Does zero typing allow pasting the disposable GitHub code on the phone? Which phone, passkey or Mobile 2FA enrollment and first-shell access method should the acceptance test use?
- Is a protected headless keyring available after reboot, or is owner-only gh storage on encrypted EBS acceptable? Which private repository and OAuth scopes are acceptable for verification?
- Who owns recovery for a lost phone, and when should the old host and its credentials be retired?
