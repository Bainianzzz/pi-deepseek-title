/**
 * DeepSeek conversation titles
 * (https://api-docs.deepseek.com/zh-cn/guides/conversation_title)
 *
 * Adds `"title": {"enabled": true}` to the first provider request of a new
 * conversation, reads the title companion returned in the response stream, and
 * stores it as the pi session name. That is all it takes: pi's own footer shows
 * the session name on the path line and `/resume` shows it in the session list.
 *
 * Only the Responses API is handled: it is the mode where DeepSeek generates a
 * title on its own.
 *
 * The title is requested once per conversation. Sessions that already contain
 * an assistant message or a name are left untouched. When the response carries
 * no title (refusal, error, tool-only answer) nothing is stored and the session
 * list keeps falling back to the first user message.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

function stringTitle(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const title = (value as { title?: unknown }).title;
	return typeof title === "string" ? title : undefined;
}

/** Responses API: `response.completed` carries `response.title`. */
function extractTitle(data: unknown): string | undefined {
	if (!data || typeof data !== "object") return undefined;
	return stringTitle((data as { response?: unknown }).response);
}

function normalizeTitle(raw: string): string | undefined {
	const text = raw.replace(/\s+/g, " ").trim();
	if (!text) return undefined;
	return Array.from(text).slice(0, 120).join("");
}

function supportsTitle(model: Model<any> | undefined): boolean {
	if (!model || model.api !== "openai-responses") return false;
	if (model.provider.toLowerCase().includes("deepseek")) return true;
	return (model.baseUrl ?? "").toLowerCase().includes("deepseek");
}

function hasAssistantMessage(manager: ExtensionContext["sessionManager"]): boolean {
	return manager.getBranch().some((entry) => entry.type === "message" && entry.message.role === "assistant");
}

export default function (pi: ExtensionAPI) {
	let title: string | undefined;
	let pendingTitle: string | undefined;
	let titleRequested = false;

	const flushTitle = () => {
		if (!pendingTitle) return;
		const next = pendingTitle;
		pendingTitle = undefined;
		if (next === title) return;
		title = next;
		pi.setSessionName(next);
	};

	pi.on("session_start", (_event, ctx) => {
		pendingTitle = undefined;
		const name = ctx.sessionManager.getSessionName();
		title = name;
		titleRequested = Boolean(name) || hasAssistantMessage(ctx.sessionManager);
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (titleRequested) return;
		if (!supportsTitle(ctx.model)) return;
		if (hasAssistantMessage(ctx.sessionManager)) {
			titleRequested = true;
			return;
		}
		titleRequested = true;
		const payload = event.payload;
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
		if ("title" in payload) return;
		return { ...(payload as Record<string, unknown>), title: { enabled: true } };
	});

	pi.on("provider_stream_event", (event, ctx) => {
		if (title || pendingTitle) return;
		if (!supportsTitle(ctx.model)) return;
		const raw = extractTitle(event.data);
		if (!raw) return;
		const next = normalizeTitle(raw);
		if (next) pendingTitle = next;
	});

	// Store the title once the assistant message is on disk, so the session_info
	// entry lands after it instead of in the middle of the stream.
	pi.on("message_end", (event) => {
		if (event.message.role === "assistant") flushTitle();
	});

	pi.on("agent_end", () => flushTitle());
}
