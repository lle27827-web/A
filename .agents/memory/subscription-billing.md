---
name: Independent subscription billing
description: Rules for separate personal/business access, trial timing, and Vercel-safe payment QR storage.
---

Keep personal notebook access and business access as independent subscription scopes. A renewal, manual grant, or manual block for one scope must not silently change the other. Fee switches default off; a manual denial remains effective even when a fee switch is off. Payment is reviewed manually and must not automatically remove an admin block.

Start a personal 30-day trial on the first verified personal-service access after personal billing is enabled. Start a business trial only after business billing is enabled (for existing businesses when first enabled, or on the first business access afterward). Do not consume a free trial while that product's fee switch is off.

Store the bounded payment QR image (maximum 1 MB) in the DB3 billing registry rather than Replit Object Storage.

**Why:** billing must not unexpectedly lock existing users, trials should remain available until the corresponding fee is active, and Vercel cannot depend on Replit-only storage sidecar credentials.

**How to apply:** keep subscription records and platform settings in the DB3 control plane; gate personal and business API routes independently; leave fees off until the admin uploads a QR and explicitly enables the corresponding product.
