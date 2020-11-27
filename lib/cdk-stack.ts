import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as iam from '@aws-cdk/aws-iam';
import * as batch from '@aws-cdk/aws-batch';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ecr from '@aws-cdk/aws-ecr';

export class CdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /*
     * 1. コンピューティング環境の用意
     */
    // 既存のコンピューティング環境を使う場合
    const computeEnvironment: batch.IComputeEnvironment = batch.ComputeEnvironment.fromComputeEnvironmentArn(
      this, 'BatchCompute', 'arn:aws:batch:ap-northeast-1:0123456789:compute-environment/ExampleComputeEnvironment'
    );

    // 新規でコンピューティング環境の作成する場合
    // const computeEnvironment: batch.IComputeEnvironment = this.createComputeEnvironment()


    /*
     * 2. イメージの用意
     * Jobで使用するイメージをECRにプッシュする
     * 事前にリポジトリを用意する必要はない
     * Dockerfileだけ用意してあれば事前にビルドする必要もない
     */
    // Dockerイメージを作成してECRにプッシュ
    const tag = '適当なタグ名'
    const imageAsset: cdk.DockerImageAssetLocation = this.synthesizer.addDockerImageAsset({
      sourceHash: tag,
      directoryName: `./docker/`,
      repositoryName: 'example',
    })

    // ECRからリポジトリを取得
    const repository: ecr.IRepository = ecr.Repository.fromRepositoryName(
      this,
      `ECRRepository`,
      imageAsset.repositoryName,
    )

    // リポジトリから特定のイメージを取得
    const image = ecs.ContainerImage.fromEcrRepository(repository, tag)


    /*
     * 3. ジョブキューとジョブ定義を用意
     */
    // Job用ロールを作成
    const jobRole: iam.IRole = new iam.Role(this, 'JobRole', {
      roleName: 'ExampleJobRole',
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      ),
    });

    // ジョブキューを作成
    new batch.JobQueue(this, 'JobQueue', {
      jobQueueName: 'ExampleJobQueue',
      computeEnvironments: [{
          computeEnvironment: computeEnvironment,
          order: 1,
      }],
    });

    // ジョブの定義を作成
    new batch.JobDefinition(this, 'JobDefinition', {
      jobDefinitionName: 'ExampleJobDefinition',
      container: {
        command: ['date'],
        environment: {'TZ': 'Asia/Tokyo'},
        image: image,
        jobRole: jobRole,
        vcpus: 1,
        memoryLimitMiB: 100,
      }
    });
  }



  // 新規でコンピューティング環境を作成する
  protected createComputeEnvironment(): batch.IComputeEnvironment {
    /*
     * 1-1. ネットワーク情報を取得
     */
    // 既存のVPCを取得
    const vpc: ec2.IVpc = ec2.Vpc.fromLookup(this, 'VPC', {
      vpcId: 'vpc-0123456789abcdef',
    });

    // 既存のサブネットを取得
    const selectSubnets: ec2.SelectedSubnets = vpc.selectSubnets({
      subnets: [
        ec2.Subnet.fromSubnetAttributes(this, 'Subnet', {
          subnetId: 'subnet-0123456789abcdef',
          availabilityZone: 'ap-northeast-1a',
          routeTableId: 'rtb-0123456789abcdef',
        }),
      ]
    });

    // 既存のセキュリティーグループを取得
    const securityGroup: ec2.ISecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this, 'SecurityGroup', 'sg-0123456789abcdef',
    );

    /*
     * 1-2. ロールを作成
     */
    // AWSBatch用ロールを作成
    const batchRole: iam.IRole = new iam.Role(this, 'BatchRole', {
      roleName: 'ExampleBatchRole',
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('batch.amazonaws.com'),
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromManagedPolicyArn(
          this,
          'AWSBatchServiceRole',
          'arn:aws:iam::aws:policy/service-role/AWSBatchServiceRole',
        ),
      ],
    });
    // 既存のロールを使う場合
    // const batchRole: iam.IRole = iam.Role.fromRoleArn(
    //   this, 'BatchRole', `arn:aws:iam::${this.account}:role/service-role/AWSBatchServiceRole`
    // );

    // ECSInstance用ロールを作成
    const instanceRole: iam.IRole = new iam.Role(this, 'InstanceRole', {
      roleName: 'ExampleInstanceRole',
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('ec2.amazonaws.com'),
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromManagedPolicyArn(
          this,
          'AmazonEC2ContainerServiceforEC2Role',
          'arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role',
        ),
      ],
    });
    // 既存のロールを使う場合
    // const instanceRole: iam.CfnInstanceProfile = iam.Role.fromRoleArn(
    //   this, 'InstanceRole', `arn:aws:iam::${this.account}:role/ecsInstanceRole`
    // );

    // インスタンスプロフィールを作成
    const instanceProfile: iam.CfnInstanceProfile = new iam.CfnInstanceProfile(this, 'InstanceProfile', {
      instanceProfileName: 'Example',
      roles: [instanceRole.roleName],
    });

    /*
     * 1-3. コンピューティング環境を作成
     */
    // コンピューティング環境を作成
    const computeEnvironment: batch.ComputeEnvironment = new batch.ComputeEnvironment(this, 'BatchCompute', {
      computeEnvironmentName: 'ExampleComputeEnvironment',
      computeResources: {
        type: batch.ComputeResourceType.ON_DEMAND,
        instanceRole: instanceProfile.attrArn,
        vpc: vpc,
        vpcSubnets: selectSubnets,
        securityGroups: [securityGroup],
      },
      serviceRole: batchRole,
    });

    return computeEnvironment
  }
}
