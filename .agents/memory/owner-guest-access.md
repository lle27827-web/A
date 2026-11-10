---
name: Owner and guest access
description: Product rules for mandatory login, owner-managed delegated access, private notebooks and session verification.
---

Guests who have not signed in must not view facility data, including employee details. Show a welcome with “Chào mừng bạn đến với Sổ Công”, “Hãy đăng nhập để sử dụng dịch vụ”, and login/signup actions.

**Why:** the user explicitly replaced the previous public employee-view policy with mandatory login when requesting manager permissions.

**How to apply:** enforce sign-in on facility reads as well as writes, not merely by hiding links. Preserve the existing app-specific Clerk authentication across Replit and Vercel.

The verified owner retains full access and can grant any valid facility permissions to managers. Managers may delegate rights to other accounts only within or below their own current permissions and employee scope; they cannot create, edit, or revoke their own grant. New accounts receive no facility access automatically.

**Why:** the user chose both owner-to-manager permission grants and manager-to-account delegation limited to the manager's own authority.

**How to apply:** resolve grants using the authenticated account's verified email, never client-supplied identity. Restrict manager grant lists and mutations to grants no broader than the manager's own. Keep owner grants unrestricted and prevent managers from changing their own permissions. Restrict lists, search, totals, comparison and writes consistently. Editing a card-linked shift also requires card-edit rights.

Every signed-in account may keep a separate personal employee notebook: own attendance, own service/pay rates, own income and month history. This is not the facility's read-only employee-view filter, and it does not include personal customer/card management.

**Why:** the user explicitly chose “Tự chấm công, dịch vụ/mức tiền riêng, thu nhập và lịch sử” and requested complete separation for each account.

**How to apply:** derive identity only from the verified session; scope all personal data by account, including owner accounts. Personal writes never change facility data. Comparison requires a separate comparison grant, independent of employee-list visibility; it shows daily/monthly **pay** and service/customer-name details, not facility cash revenue, phone numbers or another account's private notebook. Membership may enable the joined user to choose the facility's service catalog for their own notebook, but does not grant general facility access. Revoking facility rights must not erase the account's own notebook.

Accounts that have not completed role onboarding see the personal, owner, and employee choices once; skipping defaults to the personal notebook. Businesses are logical partitions by `business_id` in the existing four shared Neon stores, not separate physical databases. Joining with the 10-digit code creates membership but does not grant facility permissions by itself.

**Why:** the user chose personal as the default, selected shared four-database partitioning, and kept facility access under owner-managed permissions.

**How to apply:** keep role and business setup in Settings; identify the business from the verified 10-digit join code on the server. Preserve current business data and personal notebooks when changing the account's workspace choice.

Resolve a business membership only by the authenticated Clerk user ID; email is profile data and must not grant membership by itself. Each facility request must use the active business ID verified by server-side membership checks, with no route fallback to a default tenant. Keep user-to-business membership many-to-many so one account can join multiple businesses.

**Why:** the user requires the business code to establish tenant scope before access is granted, and existing users may belong to more than one business.

**How to apply:** use the 10-digit code to create a membership linking the user identity to the selected business; keep owner-granted facility permissions separate. Derive all facility query scopes from verified server auth, not request bodies, email matches, or default IDs.

If Clerk has verified the user but the business registry or permission store is unavailable, keep the authenticated personal notebook usable while returning no business membership or permissions and clearly marking business access unavailable.

**Why:** A DB4 or grants-store outage should not lock users out of their personal records, while stale or cross-database fallback data could grant access to the wrong business.

**How to apply:** keep identity verification separate from business authorization; on registry failure fail closed for business access, surface a warning, and never infer grants from another store.

On the first authenticated session, offer personal, owner, and employee paths; skipping means personal. An employee may leave only the selected business, revoking that account's grant and membership while retaining login, personal data, all business records, and other memberships. Owners cannot leave before transferring ownership. Rejoining by a valid code restores membership only and never restores manager rights automatically.

**Why:** the user requested first-login role selection, safe single-business departure, retained records, and a permission-free rejoin.

**How to apply:** store the role choice as a user-scoped preference, but enforce all authority server-side. Revoke the employee's business grant before deactivating membership so partial failures remain fail-closed and retryable.

Legacy access cleanup must revoke facility memberships/grants without deleting login identities or personal notebooks. Inspect the affected scope and obtain confirmation before changing production access.

**Why:** the user chose revocation rather than account deletion and asked to retain personal data.

**How to apply:** inventory first, then apply only the confirmed revocations; never clear business records or personal notebooks as part of account access cleanup.

Do not offer the facility “Xem như nhân viên” view mode in Settings. Keep personal attendance as a separate account-scoped notebook.

**Why:** the user explicitly asked to remove “Xem như nhân viên” from Settings while keeping multi-account facility grants.

**How to apply:** do not restore the old view-mode control to Settings; retain the separate personal notebook entry and its identity isolation.

Valid sessions must be restored automatically when the app starts or the page reloads, without requiring another reload. Do not turn a temporarily unverified signed-in session into a guest and redirect away from the user's page.

**Why:** the user requested automatic restoration of an existing valid session during application initialization.

**How to apply:** let Clerk manage session persistence and renewal; grant owner access only after server verification. Session synchronization or network failures are not proof that the user signed out. Keep guest and owner data isolated when sessions change.

Do not assume that Replit's managed Clerk test helper authenticates against the same instance used by this app's APP_CLERK configuration.

**Why:** the helper returned a sign-in redirect but did not establish a server-recognized session for this app; browser authentication remained unverified. This alone does not establish that normal user sign-in is broken.

**How to apply:** confirm that test authentication targets the app's actual provider before interpreting results. Report a blocked authenticated-browser test honestly; never rotate keys or migrate the tenant solely to make the helper work.

Authentication pages must explicitly leave the sign-in/sign-up form after server verification succeeds, and show a visible recovery screen if an existing session cannot be verified.

**Why:** Clerk's sign-in/sign-up widgets may render nothing for an already signed-in account. Exempting those URLs from verification errors can strand the user without a usable login form.

**How to apply:** keep the verification gate active on authentication routes too; redirect verified accounts to a whitelisted local destination. Never fix a blank login state by granting owner access or bypassing server verification.

Clerk sign-in and sign-up interface text must use Vietnamese. Google sign-in must request the `select_account` OIDC prompt so the user can choose a Google account before continuing.

**Why:** the user requested Vietnamese login-method labels and an account chooser when signing in with Google.

**How to apply:** use Clerk's Vietnamese localization for the full auth widgets and set `oidcPrompt: "select_account"` on the Google sign-in redirect; keep the existing server-side session and permission checks.

Do not rely solely on cookies for authenticated API calls in the embedded Replit preview, even when the frontend and API share the same public origin.

**Why:** a Clerk session can exist in the frontend while the API sees an anonymous request inside the iframe. Explicit SDK session-token transport allowed the existing server-side owner checks to recognize that session.

**How to apply:** obtain the current token through Clerk, send it only to this application's own API, clear the binding on account/session changes, and never persist tokens. For browser verification, inspect requests made by the application's API client; plain fetch calls do not automatically use its token binding.
