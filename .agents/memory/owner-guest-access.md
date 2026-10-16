---
name: Owner and guest access
description: Product rules for mandatory login, owner-managed delegated access, private notebooks and session verification.
---

Guests who have not signed in must not view facility data, including employee details. Show a welcome with “Chào mừng bạn đến với Sổ Công”, “Hãy đăng nhập để sử dụng dịch vụ”, and login/signup actions.

**Why:** the user explicitly replaced the previous public employee-view policy with mandatory login when requesting manager permissions.

**How to apply:** enforce sign-in on facility reads as well as writes, not merely by hiding links. Preserve the existing app-specific Clerk authentication across Replit and Vercel.

The verified owner retains full access and alone grants or revokes facility rights per account. Delegated accounts see only the employee scope chosen by the owner; card visibility, revenue visibility and editing are separate choices. New accounts receive no facility access automatically.

**Why:** the user asked to choose which employees each manager can view, whether they can view cards and revenue, and what they can edit.

**How to apply:** resolve grants using the authenticated account's verified email, never client-supplied identity. Restrict lists, search, totals, comparison and writes consistently. Editing a card-linked shift also requires card-edit rights. Do not let managers grant rights to themselves or others.

Every signed-in account may keep a separate personal employee notebook: own attendance, own service/pay rates, own income and month history. This is not the facility's read-only employee-view filter, and it does not include personal customer/card management.

**Why:** the user explicitly chose “Tự chấm công, dịch vụ/mức tiền riêng, thu nhập và lịch sử” and requested complete separation for each account.

**How to apply:** derive identity only from the verified session; scope all personal data by account, including owner accounts. Personal writes never change facility data. Comparison requires permission to view the selected central employee; it shows their daily/monthly **pay** and service/customer-name details, not facility cash revenue, phone numbers or another account's private notebook. Revoking facility rights must not erase the account's own notebook.

Valid sessions must be restored automatically when the app starts or the page reloads, without requiring another reload. Do not turn a temporarily unverified signed-in session into a guest and redirect away from the user's page.

**Why:** the user requested automatic restoration of an existing valid session during application initialization.

**How to apply:** let Clerk manage session persistence and renewal; grant owner access only after server verification. Session synchronization or network failures are not proof that the user signed out. Keep guest and owner data isolated when sessions change.

Do not assume that Replit's managed Clerk test helper authenticates against the same instance used by this app's APP_CLERK configuration.

**Why:** the helper returned a sign-in redirect but did not establish a server-recognized session for this app; browser authentication remained unverified. This alone does not establish that normal user sign-in is broken.

**How to apply:** confirm that test authentication targets the app's actual provider before interpreting results. Report a blocked authenticated-browser test honestly; never rotate keys or migrate the tenant solely to make the helper work.

Authentication pages must explicitly leave the sign-in/sign-up form after server verification succeeds, and show a visible recovery screen if an existing session cannot be verified.

**Why:** Clerk's sign-in/sign-up widgets may render nothing for an already signed-in account. Exempting those URLs from verification errors can strand the user without a usable login form.

**How to apply:** keep the verification gate active on authentication routes too; redirect verified accounts to a whitelisted local destination. Never fix a blank login state by granting owner access or bypassing server verification.

Do not rely solely on cookies for authenticated API calls in the embedded Replit preview, even when the frontend and API share the same public origin.

**Why:** a Clerk session can exist in the frontend while the API sees an anonymous request inside the iframe. Explicit SDK session-token transport allowed the existing server-side owner checks to recognize that session.

**How to apply:** obtain the current token through Clerk, send it only to this application's own API, clear the binding on account/session changes, and never persist tokens. For browser verification, inspect requests made by the application's API client; plain fetch calls do not automatically use its token binding.
