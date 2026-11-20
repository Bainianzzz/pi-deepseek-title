/**
 * DeepSeek conversation titles
 * (https://api-docs.deepseek.com/zh-cn/guides/conversation_title)
 *
 * Adds `"title": {"enabled": true}` to provider requests of a new conversation,
 * reads the title companion returned in the response stream, and stores it as
 * the pi session name. That is all it takes: pi's own footer shows the session
 * name on the path line and `/resume` shows it in the session list.
 *
 * Only the Responses API is handled: it is the mode where DeepSeek generates a
 * title on its own.
 *
 * A response does not always carry a title (refusal, error, tool-only answer),
 * so every request is tagged until a title actually shows up. Sessions that
 * already contain an assistant message or a name when they start are left
 * untouched; until then the session list falls back to the first user message.
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
	// Session already had a name or a turn when it started: don't ask for titles.
	let skipTitle = false;

	const flushTitle = () => {
		if (!pendingTitle) return;
		const next = pendingTitle;
		pendingTitle = undefined;
		if (next === title) return;
		title = next;
		pi.setSessionName(next);
	};

	pi.on("session_start", (event, ctx) => {
		pendingTitle = undefined;
		const name = ctx.sessionManager.getSessionName();
		title = name;
		// A resumed/forked session keeps its history; an in-session /reload does not
		// end the conversation, so it keeps asking for a title.
		skipTitle = Boolean(name) || (hasAssistantMessage(ctx.sessionManager) && event.reason !== "reload");
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (skipTitle || title) return;
		if (!supportsTitle(ctx.model)) return;
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
