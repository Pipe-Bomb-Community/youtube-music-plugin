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

async function findInPath(): Promise<string | null> {
	try {
		const cmd = process.platform === "win32" ? "where" : "which";
		const { stdout } = await execFileAsync(cmd, ["yt-dlp"]);
		return stdout.trim().split("\n")[0] || null;
	} catch {
		return null;
	}
}

async function downloadFile(url: string, dest: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const file = createWriteStream(dest);

		function request(target: string) {
			get(target, (res) => {
				if (res.statusCode === 301 || res.statusCode === 302) {
					request(res.headers.location!);
					return;
				}
				if (res.statusCode !== 200) {
					reject(new Error(`HTTP ${res.statusCode} downloading yt-dlp`));
					return;
				}
				res.pipe(file);
				res.on("error", reject);
				file.on("finish", () => file.close(() => resolve()));
			}).on("error", reject);
		}

		request(url);
	});
}

export async function resolveYtDlp(cacheDir: string): Promise<string> {
	const system = await findInPath();
	if (system) {
		return system;
	}

	const binaryName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
	const cached = path.join(cacheDir, binaryName);
	if (existsSync(cached)) {
		return cached;
	}

	const url = getBinaryUrl();
	await downloadFile(url, cached);

	if (process.platform !== "win32") {
		await chmod(cached, 0o755);
	}

	return cached;
}
