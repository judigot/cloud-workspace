# GitHub authentication

The development subdomain can use GitHub as its single browser authentication layer.

## Architecture

Browser requests reach Nginx first. Nginx asks a local oauth2-proxy service to validate the session before forwarding traffic to OpenCode, the workspace API, development applications, HMR endpoints, or WebSocket endpoints.

The public application domain remains unchanged. GitHub authentication applies to the development subdomain only.

## GitHub OAuth application

Create a GitHub OAuth App with:

- Homepage URL: `https://dev.<your-domain>`
- Authorization callback URL: `https://dev.<your-domain>/oauth2/callback`

The OAuth application is used only to verify identity. It should not request repository write permissions.

## Workspace configuration

Set `WORKSPACE_AUTH_PROVIDER=github` and provide the GitHub OAuth client ID, client secret, allowed GitHub usernames, and oauth2-proxy cookie secret in the workspace `.env` file.

The allowed-user list is mandatory. Signing in with GitHub does not grant access unless the authenticated username is explicitly listed.

The cookie secret and GitHub client secret must not be committed to Git.

## Deployment behavior

Running the existing Nginx deployment script will:

1. generate the normal workspace Nginx configuration;
2. install and configure oauth2-proxy when GitHub authentication is selected;
3. add GitHub authentication enforcement to the development subdomain;
4. validate the final Nginx configuration;
5. reload Nginx.

The OAuth gateway listens only on localhost. OpenCode and development application ports must also remain inaccessible from the public internet.

## Authentication boundary

GitHub authentication protects HTTP and WebSocket traffic routed through the development Nginx server. This includes OpenCode, the workspace API, terminal WebSockets, Vite HMR, and development app routes.

It does not authenticate SSH, Mosh, databases, or any service exposed directly outside Nginx. Those require separate controls.

## Rollback

Set the authentication provider back to `nginx` or `opencode`, then redeploy Nginx. The existing authentication modes remain supported.
