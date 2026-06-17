#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { InboxAgentStack } from "../lib/inbox-agent-stack";

const app = new cdk.App();

new InboxAgentStack(app, "InboxAgentStack", {
  // Account-agnostic: deploys to whatever account/region the executing CLI
  // credentials point at. Both are undefined during `cdk synth` with no
  // credentials, which makes the stack environment-agnostic (CDK fills in dummy
  // AZs) so synth runs offline.
  // `|| undefined` so an empty-string env var still yields an environment-agnostic
  // stack (CfnEnvironment treats "" as a concrete, invalid env otherwise).
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || undefined,
    region: process.env.CDK_DEFAULT_REGION || undefined,
  },
  description:
    "Inbox agent demo — Fargate service + RDS Postgres. Throwaway: deploy, screenshot, destroy.",
});
