import { CosmosClient } from "@azure/cosmos";
import { app } from "@azure/functions";
import { DefaultAzureCredential } from "@azure/identity";
import axios from "axios";
import {
	getAvgInteractionsPerUser,
	getDistinctUsers,
	getErrorCount,
	getFeedbackBreakdown,
	getFeedbackResponseRate,
	getRateLimitedCount,
	getSessionCount,
	getTotalInteractions,
} from "../lib/cosmos-queries.js";
import { getSlackWebhookUrl } from "../lib/key-vault-client.js";
import { formatWeeklyReport } from "../lib/slack-formatter.js";

const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT;
const COSMOS_DATABASE = process.env.COSMOS_DATABASE || "fiona";
const COSMOS_INTERACTIONS_CONTAINER =
	process.env.COSMOS_INTERACTIONS_CONTAINER || "interactions";
const COSMOS_FEEDBACK_CONTAINER =
	process.env.COSMOS_FEEDBACK_CONTAINER || "feedback";
const DEPLOYMENT_TYPE = process.env.DEPLOYMENT_TYPE || "production";
const SLACK_WEBHOOK_SECRET_NAME =
	process.env.SLACK_WEBHOOK_KEYVAULT_SECRET_NAME ||
	"slack-fiona-weekly-report-webhook";

app.timer("WeeklyReportTrigger", {
	schedule: "%REPORT_SCHEDULE%",
	handler: async (myTimer, context) => {
		const logger = context.log;
		logger("Weekly report function triggered");

		try {
			// Initialize Cosmos DB client using Managed Identity
			const cosmosClient = new CosmosClient({
				endpoint: COSMOS_ENDPOINT,
				aadCredentials: new DefaultAzureCredential(),
			});

			const database = cosmosClient.database(COSMOS_DATABASE);
			const interactionsContainer = database.container(
				COSMOS_INTERACTIONS_CONTAINER,
			);
			const feedbackContainer = database.container(COSMOS_FEEDBACK_CONTAINER);

			// Calculate lookback window (past 7 days)
			const now = new Date();
			const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
			const oneWeekAgoISO = oneWeekAgo.toISOString();

			// Query all KPIs in parallel
			logger("Querying KPIs from Cosmos DB...");
			const [
				distinctUsers,
				sessionCount,
				totalInteractions,
				errorCount,
				rateLimitedCount,
				feedbackBreakdown,
				avgInteractionsPerUser,
				feedbackResponseRate,
			] = await Promise.all([
				getDistinctUsers(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
				getSessionCount(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
				getTotalInteractions(
					interactionsContainer,
					DEPLOYMENT_TYPE,
					oneWeekAgoISO,
				),
				getErrorCount(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
				getRateLimitedCount(
					interactionsContainer,
					DEPLOYMENT_TYPE,
					oneWeekAgoISO,
				),
				getFeedbackBreakdown(feedbackContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
				getAvgInteractionsPerUser(
					interactionsContainer,
					DEPLOYMENT_TYPE,
					oneWeekAgoISO,
				),
				getFeedbackResponseRate(
					interactionsContainer,
					feedbackContainer,
					DEPLOYMENT_TYPE,
					oneWeekAgoISO,
				),
			]);

			// Parse feedback counts
			const goodFeedback =
				feedbackBreakdown.find((f) => f.value === "good-feedback")?.count ?? 0;
			const badFeedback =
				feedbackBreakdown.find((f) => f.value === "bad-feedback")?.count ?? 0;
			const feedbackRatio =
				goodFeedback + badFeedback > 0
					? (goodFeedback / (goodFeedback + badFeedback)) * 100
					: 0;
			const errorRate =
				totalInteractions > 0 ? (errorCount / totalInteractions) * 100 : 0;

			// Build week label dates
			const endOfReport = new Date(now.getTime() - 24 * 60 * 60 * 1000);

			const kpis = {
				distinctUsers,
				sessionCount,
				totalInteractions,
				errorCount,
				errorRate,
				rateLimitedCount,
				goodFeedback,
				badFeedback,
				feedbackRatio,
				avgInteractionsPerUser,
				feedbackResponseRate,
				environment: DEPLOYMENT_TYPE,
				startDate: oneWeekAgo.toISOString().split("T")[0],
				endDate: endOfReport.toISOString().split("T")[0],
			};

			const message = formatWeeklyReport(kpis);
			logger(`Report formatted: ${message.substring(0, 100)}...`);

			// Post to Slack via webhook
			const webhookUrl = await getSlackWebhookUrl(SLACK_WEBHOOK_SECRET_NAME, {
				error: logger,
			});
			logger("Retrieved webhook URL from Key Vault, posting to Slack...");

			await axios.post(webhookUrl, { text: message });

			logger("Weekly report posted successfully");
		} catch (error) {
			logger.error(`Error generating weekly report: ${error.message}`);
			logger.error(error.stack);
		}
	},
});
