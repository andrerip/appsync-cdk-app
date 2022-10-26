import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { CfnDataSource, CfnGraphQLApi, CfnGraphQLSchema, CfnResolver} from "aws-cdk-lib/aws-appsync";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { Effect, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { readFileSync } from "fs";

export class AppsyncCdkAppStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const appSyncApi = this.createAppSyncApi();
    const schema = this.createSchema(appSyncApi.attrApiId);

    const lambda = this.createLambda();
    const lambdaRole = this.createLambdaRole(lambda.functionArn);

    this.createSourcesAndResolvers(appSyncApi.attrApiId, schema, lambda.functionArn, lambdaRole.roleArn);

    const notesTable = this.createTable();
    notesTable.grantFullAccess(lambda);

    // Create an environment variable that we will use in the function code
    lambda.addEnvironment("NOTES_TABLE", notesTable.tableName);

    // Prints out the stack region to the terminal
    new cdk.CfnOutput(this, "Stack Region", {
      value: this.region,
    });
  }

  private createAppSyncApi() {
    const api = new CfnGraphQLApi(this, "graphql-api-id", {
      name: "cdk-notes-appsync-api",
      authenticationType: "API_KEY",
      xrayEnabled: true,
    });

    // Prints out the AppSync GraphQL endpoint to the terminal
    new cdk.CfnOutput(this, "GraphQLAPIURL", {
      value: api.attrGraphQlUrl,
    });

    // Prints out the AppSync GraphQL API key to the terminal
    new cdk.CfnOutput(this, "GraphQLAPIKey", {
      value: api.attrApiId || "",
    });

    return api;
  }

  private createSchema(appSyncApiId:string) {
    return new CfnGraphQLSchema(this, "graphql-api-schema", {
      apiId: appSyncApiId,
      definition: readFileSync("./graphql/schema.graphql").toString(),
    });
  }

  private createLambda() {
    return new NodejsFunction(this, "lambda-function-id", {
      entry: "./lambda-fns/main.ts",
      handler: "handler",
      functionName: "lambda-function-name",
      runtime: Runtime.NODEJS_16_X,
    });
  }

  private createLambdaRole(functionArn: string) {
    let invokeLambdaRole = new Role(this, "AppSync-InvokeLambdaRole", {
      assumedBy: new ServicePrincipal("appsync.amazonaws.com"),
    });
    invokeLambdaRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: [functionArn],
        actions: ["lambda:InvokeFunction"],
      })
    );
    return invokeLambdaRole;
  }

  private createSourcesAndResolvers(
    appSyncApiId:string,
    schema: cdk.aws_appsync.CfnGraphQLSchema,
    functionArn: string,
    roleArn: string
  ) {
    const lambdaDataSource = new CfnDataSource(this, "lambda-datasource", {
      apiId: appSyncApiId,
      name: "LambdaDataSource",
      type: "AWS_LAMBDA",
      lambdaConfig: {
        lambdaFunctionArn: functionArn,
      },
      serviceRoleArn: roleArn,
    });
    const getNoteById = new CfnResolver(this, "lambda-resolver-1", {
      apiId: appSyncApiId,
      typeName: "Query",
      fieldName: "getNoteById",
      dataSourceName: lambdaDataSource.name,
    });
    getNoteById.addDependsOn(schema);

    const createNote = new CfnResolver(this, "lambda-resolver-2", {
      apiId: appSyncApiId,
      typeName: "Mutation",
      fieldName: "createNote",
      dataSourceName: lambdaDataSource.name,
    });
    createNote.addDependsOn(schema);
  }

  private createTable() {
    return new Table(this, "CDKNotesTable", {
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
    });
  }
}
