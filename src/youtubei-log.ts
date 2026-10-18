import { Log } from "youtubei.js";
import { Logger } from "@pipe-bomb/plugin-sdk";

const TAG = "[YOUTUBEJS]";
const PARSER_TAG = "[YOUTUBEJS][Parser]";

let logger: Logger | null = null;
let forwarding = false;
let restore: (() => void) | null = null;

function forward(level: "error" | "warn" | "info" | "debug", args: unknown[]): boolean {
	if (forwarding || !logger) {
		return false;
	}

	const [first, ...rest] = args;
	if (typeof first != "string" || !first.startsWith(TAG)) {
		return false;
	}

	forwarding = true;
	try {
		switch (level) {
			case "error":
				logger.error(first, ...rest);
				break;
			case "warn":
				if (first.startsWith(PARSER_TAG)) {
					logger.debug(first, ...rest);
				} else {
					logger.warn(first, ...rest);
				}
				break;
			default:
				logger.verbose(first, ...rest);
				break;
		}
	} finally {
		forwarding = false;
	}

	return true;
}

export function captureYouTubeiLogs(pluginLogger: Logger): void {
	logger = pluginLogger;

	if (restore) {
		return;
	}

	const target = console as any;
	const originals = {
		warn: target.warn,
		error: target.error,
		info: target.info,
		debug: target.debug,
	};

	target.warn = (...args: unknown[]) => {
		if (!forward("warn", args)) originals.warn(...args);
	};
	target.error = (...args: unknown[]) => {
		if (!forward("error", args)) originals.error(...args);
	};
	target.info = (...args: unknown[]) => {
		if (!forward("info", args)) originals.info(...args);
	};
	target.debug = (...args: unknown[]) => {
		if (!forward("debug", args)) originals.debug(...args);
	};

	Log.setLevel(Log.Level.ERROR, Log.Level.WARNING);

	restore = () => {
		target.warn = originals.warn;
		target.error = originals.error;
		target.info = originals.info;
		target.debug = originals.debug;
		restore = null;
		logger = null;
	};
}

export function releaseYouTubeiLogs(): void {
	restore?.();
}
