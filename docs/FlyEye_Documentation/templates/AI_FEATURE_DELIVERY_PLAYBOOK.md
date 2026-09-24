# AI Delivery Policy Adaptation Checklist

## Use in FlyEye

This is a template for adapting the delivery model to another repository, not a
second FlyEye policy. In FlyEye, use these canonical owners:

| Concern | Owner |
|---|---|
| Authorization, hard stops and progress reporting | [AGENTS.md](../../../AGENTS.md) |
| Task planning, review, publication and integration | [AI Development Guide](../09_AI_DEVELOPMENT_GUIDE.md) |
| Check selection, verification tiers and evidence reuse | [QA Plan](../11_QA_TEST_PLAN.md#verification-applicability) |
| Commands, CI, secret gates and database safety | [DevSecOps](../10_DEVSECOPS_GUIDE.md) |
| Documentation structure and canonical ownership | [Documentation Standard](../DOCUMENTATION_STANDARD.md) |

## Adaptation to another repository

Before adopting the model, define and review the receiving repository's:

- bounded outcome, architecture, data classification and authority boundaries;
- permitted delivery actions and explicit merge, deployment, real-data,
  external-message and destructive-action decisions;
- verification applicability, mandatory CI, independent technical review and
  risk-triggered qualified human review;
- safe environment ownership, disposal and cleanup procedures;
- evidence targets, reuse rules, canonical document owners and live work tracking.

Replace FlyEye links with those local owners. Do not copy its aviation rules,
commands, approval envelope or reset assumptions into another project as defaults.
Keep one operative policy per concern; link to it from templates and handoffs.
