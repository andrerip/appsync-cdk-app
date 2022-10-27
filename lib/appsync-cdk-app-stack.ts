import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

import { Effect, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";

import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";

import * as appsync from "@aws-cdk/aws-appsync-alpha";

export class AppsyncCdkAppStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const appSyncApi = this.createAppSyncApi();

    const lambda = this.createLambda();
    this.createSourcesAndResolvers(appSyncApi, lambda);

    const notesTable = this.createTable();
    notesTable.grantFullAccess(lambda);

    // Create an environment variable that we will use in the function code
    lambda.addEnvironment("NOTES_TABLE", notesTable.tableName);

    new cdk.CfnOutput(this, "Stack Region", {
      value: this.region,
    });
  }

  private createAppSyncApi() {
    const api = new appsync.GraphqlApi(this, 'graphql-api-id', {
      name: 'cdk-notes-appsync-api',
      schema: appsync.Schema.fromAsset('graphql/schema.graphql'),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
          apiKeyConfig: {
            expires: cdk.Expiration.after(cdk.Duration.days(365))
          }
        },
      },
      xrayEnabled: true,
    });

    // Prints out the AppSync GraphQL endpoint to the terminal
    new cdk.CfnOutput(this, "GraphQLAPIURL", {
      value: api.graphqlUrl,
    });

    // Prints out the AppSync GraphQL API key to the terminal
    new cdk.CfnOutput(this, "GraphQLAPIKey", {
      value: api.apiKey || "",
    });

    return api;
  }

  private createLambda() {
     const lambda = new NodejsFunction(this, "lambda-function-id", {
      entry: "./lambda-fns/main.ts",
      handler: "handler",
      functionName: "lambda-function-name",
      runtime: Runtime.NODEJS_16_X,
    });

    let invokeLambdaRole = new Role(this, "AppSync-InvokeLambdaRole", {
      assumedBy: new ServicePrincipal("appsync.amazonaws.com"),
    });
    invokeLambdaRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: [lambda.functionArn],
        actions: ["lambda:InvokeFunction"],
      })
    );

    return lambda;
  }

  private createSourcesAndResolvers(api:any, lambda:any) {

    // Data source
    const lambdaDs = api.addLambdaDataSource('lambdaDatasource', lambda);

    // Resolvers
    lambdaDs.createResolver({
      typeName: "Query",
      fieldName: "getNoteById"
    });
    
    lambdaDs.createResolver({
      typeName: "Query",
      fieldName: "listNotes"
    });
    
    lambdaDs.createResolver({
      typeName: "Mutation",
      fieldName: "createNote"
    });
    
    lambdaDs.createResolver({
      typeName: "Mutation",
      fieldName: "deleteNote"
    });
    
    lambdaDs.createResolver({
      typeName: "Mutation",
      fieldName: "updateNote"
    });
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
