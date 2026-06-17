import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as rds from "aws-cdk-lib/aws-rds";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

/**
 * Inbox agent demo stack.
 *
 *   internet -> ALB -> Fargate task (Next.js standalone + Prisma) -> RDS Postgres
 *
 * Cost-conscious by design — this is meant to be `cdk deploy`-ed, screenshotted,
 * and `cdk destroy`-ed, not left running:
 *   - no NAT gateway: the task sits in a public subnet with a public IP and
 *     egresses via the internet gateway (pulls its image, calls the Anthropic API);
 *   - RDS lives in isolated subnets, reachable only from the task's security group;
 *   - the smallest sensible Fargate task (0.25 vCPU / 0.5 GB) and a t4g.micro DB;
 *   - the database is disposable (RemovalPolicy.DESTROY, no deletion protection).
 *
 * The container image is decoupled from synthesis: pass it via `-c imageUri=…`
 * (or the IMAGE_URI env var). With no value, a public placeholder keeps
 * `cdk synth` Docker-free and credential-free.
 */
export class InboxAgentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const dbName = "inbox";

    // Image to run. Build + push the Dockerfile to ECR, then pass its URI.
    const imageUri =
      (this.node.tryGetContext("imageUri") as string | undefined) ??
      process.env.IMAGE_URI ??
      // Placeholder so synth needs neither Docker nor AWS credentials. Override
      // before deploying — nginx will obviously not serve the app.
      "public.ecr.aws/docker/library/nginx:latest";

    // Seed the demo data on first boot? `-c seed=true`. Off by default. The
    // entrypoint runs the seed with SEED_SKIP_IF_POPULATED so it no-ops when the
    // DB already has data — a task replacement won't wipe a populated DB.
    const seedOnStart =
      (this.node.tryGetContext("seed") as string | undefined) === "true";

    // Model the deployed agent uses. Injected so it stays in sync with the cost
    // price map (lib/agent/cost.ts); override with `-c model=…`.
    const model =
      (this.node.tryGetContext("model") as string | undefined) ??
      "claude-sonnet-4-6";

    // --- Network ------------------------------------------------------------
    // Public subnets for the ALB + task, isolated subnets for the DB. No NAT.
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "db", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // --- Database -----------------------------------------------------------
    const db = new rds.DatabaseInstance(this, "Db", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE4_GRAVITON,
        ec2.InstanceSize.MICRO,
      ),
      allocatedStorage: 20,
      databaseName: dbName,
      // RDS generates the password into Secrets Manager. Exclude characters that
      // would break the postgres:// URL the entrypoint assembles.
      credentials: rds.Credentials.fromGeneratedSecret("inbox", {
        excludeCharacters: "/@\" '\\",
      }),
      multiAz: false,
      publiclyAccessible: false,
      backupRetention: cdk.Duration.days(0),
      // Disposable demo DB — tear down cleanly on `cdk destroy`.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    // --- Anthropic API key --------------------------------------------------
    // Created empty; set its value after deploy (the agent only runs once a key
    // is present). Kept out of the template and the image.
    const anthropicKey = new secretsmanager.Secret(this, "AnthropicApiKey", {
      description: "ANTHROPIC_API_KEY for the inbox agent — set the value after deploy.",
    });

    // --- Service ------------------------------------------------------------
    const cluster = new ecs.Cluster(this, "Cluster", { vpc });

    // Own the log group so `cdk destroy` removes it (the pattern's default group
    // is retained, which would otherwise survive teardown).
    const logGroup = new logs.LogGroup(this, "ServiceLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      "Service",
      {
        cluster,
        cpu: 256,
        memoryLimitMiB: 512,
        desiredCount: 1,
        // Pin the task arch so it matches the image. Build with
        // `docker buildx build --platform linux/amd64` (esp. on Apple Silicon) —
        // a mismatched arch ships a Prisma engine the task can't load.
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
        // Roll one task at a time, and fail (and roll back) fast if the new task
        // never goes healthy instead of hanging the deployment for hours.
        minHealthyPercent: 100,
        circuitBreaker: { rollback: true },
        publicLoadBalancer: true,
        // Public subnet + public IP = egress via IGW, so no NAT gateway needed.
        assignPublicIp: true,
        taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        // Migrations run at boot before the server listens — give the task room.
        healthCheckGracePeriod: cdk.Duration.seconds(120),
        taskImageOptions: {
          image: ecs.ContainerImage.fromRegistry(imageUri),
          containerPort: 3000,
          logDriver: ecs.LogDrivers.awsLogs({
            streamPrefix: "inbox-agent",
            logGroup,
          }),
          environment: {
            NODE_ENV: "production",
            DB_HOST: db.dbInstanceEndpointAddress,
            DB_PORT: db.dbInstanceEndpointPort,
            DB_NAME: dbName,
            SEED_ON_START: seedOnStart ? "true" : "false",
            ANTHROPIC_MODEL: model,
          },
          secrets: {
            DB_USER: ecs.Secret.fromSecretsManager(db.secret!, "username"),
            DB_PASSWORD: ecs.Secret.fromSecretsManager(db.secret!, "password"),
            ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(anthropicKey),
          },
        },
      },
    );

    // Liveness probe — the no-DB health route, not `/` (which queries Postgres).
    service.targetGroup.configureHealthCheck({
      path: "/api/health",
      healthyHttpCodes: "200",
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
    });

    // The task pulls its image from ECR (works for a private repo too).
    service.taskDefinition.executionRole?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonEC2ContainerRegistryReadOnly",
      ),
    );

    // Open the DB only to the service's security group.
    db.connections.allowDefaultPortFrom(
      service.service,
      "Fargate service to Postgres",
    );

    new cdk.CfnOutput(this, "Url", {
      value: `http://${service.loadBalancer.loadBalancerDnsName}`,
      description: "Public URL of the inbox agent",
    });
    new cdk.CfnOutput(this, "AnthropicSecretArn", {
      value: anthropicKey.secretArn,
      description: "Put the Anthropic API key here, then redeploy/restart the service.",
    });
  }
}
