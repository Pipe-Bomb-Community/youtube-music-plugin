import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWriteStream, existsSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { get } from "node:https";
import path from "node:path";

const execFileAsync = promisify(execFile);

function getBinaryUrl(): string {
	const { platform, arch } = process;

	if (platform === "linux") {
		if (arch === "x64") {
			return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
		}
		if (arch === "arm64") {
			return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64";
		}
	}
	if (platform === "darwin") {
		return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
	}
	if (platform === "win32") {
		return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
	}

	throw new Error(`No pre-built yt-dlp binary for ${platform}/${arch}`);
}

const DOWNLOAD_IDLE_TIMEOUT = 30_000;
const DOWNLOAD_TOTAL_TIMEOUT = 10 * 60_000;
const MAX_REDIRECTS = 5;

async function findInPath(): Promise<string | null> {
	try {
		const cmd = process.platform === "win32" ? "where" : "which";
		const { stdout } = await execFileAsync(cmd, ["yt-dlp"], {
			timeout: 10_000,
		});
		return stdout.trim().split("\n")[0] || null;
	} catch {
		return null;
	}
}

async function downloadFile(url: string, dest: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const file = createWriteStream(dest);
		let finished = false;
		let overallTimer: NodeJS.Timeout | undefined;

		const cleanup = () => {
			if (overallTimer) {
				clearTimeout(overallTimer);
				overallTimer = undefined;
			}
		};

		const fail = (e: Error) => {
			if (finished) {
				return;
			}
			finished = true;
			cleanup();
			file.destroy();
			reject(e);
		};

		file.on("error", fail);
		overallTimer = setTimeout(
			() => fail(new Error("Timed out downloading yt-dlp")),
			DOWNLOAD_TOTAL_TIMEOUT,
		);

		const request = (target: string, redirects: number) => {
			if (redirects > MAX_REDIRECTS) {
				fail(new Error("Too many redirects downloading yt-dlp"));
				return;
			}

			const req = get(
				target,
				{ timeout: DOWNLOAD_IDLE_TIMEOUT },
				(res) => {
					const status = res.statusCode ?? 0;
					if (
						status === 301 ||
						status === 302 ||
						status === 303 ||
						status === 307 ||
						status === 308
					) {
						const location = res.headers.location;
						res.resume();
						if (!location) {
							fail(new Error("Redirect without a location"));
							return;
						}
						request(new URL(location, target).toString(), redirects + 1);
						return;
					}
					if (status !== 200) {
						res.resume();
						fail(new Error(`HTTP ${status} downloading yt-dlp`));
						return;
					}

					res.on("error", fail);
					res.on("close", () => {
						if (!res.complete) {
							fail(
								new Error(
									"Connection closed before yt-dlp download completed",
								),
							);
						}
					});
					res.pipe(file);
					file.once("finish", () => {
						if (finished) {
							return;
						}
						finished = true;
						cleanup();
						file.close((e) => (e ? reject(e) : resolve()));
					});
				},
			);

			req.on("timeout", () =>
				req.destroy(new Error("Timed out downloading yt-dlp")),
			);
			req.on("error", fail);
		};

		request(url, 0);
	});
}

export type YtDlpResolution = {
	path: string;
	managed: boolean;
};

export async function resolveYtDlp(cacheDir: string): Promise<YtDlpResolution> {
	const system = await findInPath();
	if (system) {
		return { path: system, managed: false };
	}

	const binaryName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
	const cached = path.join(cacheDir, binaryName);
	if (existsSync(cached)) {
		return { path: cached, managed: true };
	}

	const url = getBinaryUrl();
	await downloadFile(url, cached);

	if (process.platform !== "win32") {
		await chmod(cached, 0o755);
	}

	return { path: cached, managed: true };
}

export async function updateYtDlp(
	binaryPath: string,
	logger: { debug(message: any): void },
): Promise<void> {
	const { stdout, stderr } = await execFileAsync(binaryPath, ["-U"], {
		timeout: 120_000,
	});
	for (const line of [...stdout.split("\n"), ...stderr.split("\n")]) {
		const trimmed = line.trim();
		if (trimmed) {
			logger.debug(trimmed);
		}
	}
}
