---
name: Owner and guest access
description: Product rule for owner login, anonymous guest visibility, and write permissions.
---

Guests need no login and may view the complete employee-management area, including recorded wages and work history. Guests must not access facility revenue or card management. Only the verified owner account may view those areas or write facility data. Owner authentication must use the app's existing Clerk configuration so it works on both Replit and Vercel.

**Why:** The user explicitly chose anonymous, read-only guests, owner-only editing, external Clerk across both hosts, and limited guests to employee management.

**How to apply:** Enforce the role rules on API reads and writes as well as in route visibility. Never treat a local UI/view preference as proof of owner access.

Every signed-in account may keep a separate personal employee notebook: own attendance, own service/pay rates, own income and month history. This is not the facility's read-only employee-view filter, and it does not include personal customer/card management.

**Why:** the user explicitly chose “Tự chấm công, dịch vụ/mức tiền riêng, thu nhập và lịch sử” and requested complete separation for each account.

**How to apply:** derive identity only from the verified session; scope all personal data by account, including owner accounts. Personal writes never change facility data. Comparison may show only the selected central employee's daily/monthly **pay**, beside the account's own pay, never facility revenue or another account's private notebook.

Valid sessions must be restored automatically when the app starts or the page reloads, without requiring another reload. Do not turn a temporarily unverified signed-in session into a guest and redirect away from the user's page.

**Why:** the user requested automatic restoration of an existing valid session during application initialization.

**How to apply:** let Clerk manage session persistence and renewal; grant owner access only after server verification. Session synchronization or network failures are not proof that the user signed out. Keep guest and owner data isolated when sessions change.

Do not assume that Replit's managed Clerk test helper authenticates against the same instance used by this app's APP_CLERK configuration.

**Why:** the helper returned a sign-in redirect but did not establish a server-recognized session for this app; browser authentication remained unverified. This alone does not establish that normal user sign-in is broken.

**How to apply:** confirm that test authentication targets the app's actual provider before interpreting results. Report a blocked authenticated-browser test honestly; never rotate keys or migrate the tenant solely to make the helper work.
