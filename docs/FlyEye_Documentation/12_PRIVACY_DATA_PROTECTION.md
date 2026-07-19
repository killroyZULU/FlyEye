# Privacy and Data Protection

## 1. Scope and legal posture

FlyEye will process personal, training, operational, licensing, medical-certificate, and possibly safety information. Current Philippine privacy law and National Privacy Commission guidance must be reviewed by the customer’s DPO/qualified adviser before real data is processed.

Likely model: flight school as Personal Information Controller; FlyEye as Personal Information Processor; Supabase, the frontend host, email, malware scanning, support, and AI vendors as approved subprocessors. Contracts—not this document—establish final roles.

## 2. Privacy-by-design principles

- Purpose limitation and data minimization
- Accuracy and controlled correction
- Least privilege and need-to-know access
- Transparent notices and processor/subprocessor disclosure
- Retention only as long as verified purpose/legal need
- Security appropriate to sensitivity and impact
- Data subject request handling
- Human intervention for significant AI-assisted decisions
- Accountability through PIA, contracts, logs, tests, and review

## 3. Data classification

| Class | Examples | Handling |
|---|---|---|
| Restricted | Medical/licence copies, government IDs, credentials, identified safety reports | Strong MFA/access, private storage, limited retention, detailed audit |
| Confidential | Assessments, remarks, progression, dispatch and flight records | Tenant/record controls, encryption, audit, controlled export |
| Organization-sensitive | Aircraft docs, syllabi, procedures, utilization | Tenant isolation, revision and access control |
| Internal | Configuration and non-sensitive reference data | Authenticated access/change control |
| Public | Marketing/help content | Integrity and publishing control |

## 4. Data inventory requirement

Before pilot, record every field/category, purpose, lawful basis, controller/processor, source, users/recipients, sensitivity, location/region, retention, deletion method, security, export/rights behavior, and whether AI receives it. A field without a justified purpose should not be collected.

## 5. Privacy Impact Assessment

Complete and approve a PIA before real data. Cover data flows, vulnerable users, harms from loss/alteration/disclosure, tenant leakage, support access, cloud region/transfers, external sources, automated processing, retention, rights, breach response, and mitigations. Update it after material purpose/provider/AI/security change.

## 6. Customer agreements

The DPA/customer contract should address ownership, instructions/purpose, confidentiality, security responsibilities, audit/assurance, subprocessors and transfers, incident notification, support access, retention, return/export/deletion, backups, service termination, AI restrictions, and assistance with data subject/regulatory requests.

Customer data remains the customer’s data and is not a FlyEye commercial training dataset.

## 7. User rights and records

Provide controlled workflows for access, correction, export, objection/consent preference where applicable, deactivation, and deletion/blocking where legally appropriate. Do not blindly delete records the controller must retain. Record request identity verification, decision, legal/operational basis, action, and time.

## 8. Retention and deletion

Do not invent a universal retention duration. Obtain verified regulatory, contractual, operational, and legal requirements by record type. Configure retention schedules and holds. Ensure deletion/anonymization includes database, object storage, derived exports, caches, and provider data, while documenting backup aging behavior.

The selected Supabase region, database backup tier, Storage object protection, frontend-host region/logging, and all cross-border data flows must be recorded in the data inventory and PIA. Supabase database backups must not be treated as backups of Storage objects.

## 9. Support and development access

Production support and Supabase dashboard/service-role access is approved, time-limited where possible, reasoned, least-privileged, and audited. Use impersonation only if unavoidable and clearly visible/logged. Developers use synthetic/anonymized data. Screenshots, logs, support tickets, database exports, and AI prompts must not become uncontrolled copies of restricted information.

## 10. AI privacy

Before an AI feature: document purpose and necessity, minimize/redact context, verify provider contract/retention/training terms and data region, prevent general-model training by default, restrict permissions, keep human review, record use/acceptance without storing unnecessary prompts, allow disablement, and update the PIA/subprocessor notice.

## 11. Breach response

FlyEye promptly informs the customer/DPO under contract, preserves evidence, identifies affected tenants/data, supports risk and notification assessment, contains and recovers, and documents corrective action. The responsible controller/DPO determines whether and when NPC/data-subject notification is legally required.

## 12. Pilot privacy gate

Before real pilot data: approved data inventory and PIA, signed agreements, privacy notices, role/access review, subprocessor list, tested rights/export/correction process, retention decision, incident contacts, security/recovery evidence, and staff confidentiality/training.
