# EAS credentials stored locally

This project uses the local EAS credentials source for development, preview,
and production build profiles. The real `credentials.json` and signing files
are intentionally excluded from Git and Replit deployment packages.

## Create the local file

From the workspace root, run:

```sh
pnpm --filter @workspace/socong-mobile run credentials:init
```

The initializer creates `artifacts/socong-mobile/credentials.json` only when it
does not already exist. It never overwrites an existing credentials file and
creates it with owner-only file permissions where supported.

## Add signing files and values

Edit the local `credentials.json` directly in the workspace. Put the matching
Android keystore and iOS provisioning/certificate files under the `credentials`
directory, then enter their passwords and aliases only in that local file.
Never paste signing credentials into chat, source code, or a committed file.

Run this check before a local build setup is used:

```sh
pnpm --filter @workspace/socong-mobile run credentials:check
```

The checker confirms that required values and files exist without displaying
any secret values. iOS provisioning files must match the app's eventual bundle
identifier; set and register that identifier before preparing iOS signing files.

This repository contains only the configuration and an empty local template.
No signing keys, certificates, passwords, or build have been created.
