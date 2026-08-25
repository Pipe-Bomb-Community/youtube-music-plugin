import { ConfigManager, ConfigManagerApiContext, ConfigNode } from "@sdk";

export class YTMusicConfigManager implements ConfigManager {
	private api!: ConfigManagerApiContext;

	private extractorArgs: string;
	private concurrentProducers: number;
	private cookiesBrowser: string;
	private cookiesFile: string;
	private pluginDirs: string;

	constructor(options?: {
		extractorArgs?: string;
		concurrentProducers?: number;
		cookiesBrowser?: string;
		cookiesFile?: string;
		pluginDirs?: string;
	}) {
		this.extractorArgs = options?.extractorArgs ?? "";
		this.concurrentProducers = options?.concurrentProducers ?? 1;
		this.cookiesBrowser = options?.cookiesBrowser ?? "";
		this.cookiesFile = options?.cookiesFile ?? "";
		this.pluginDirs = options?.pluginDirs ?? "";
	}

	getExtractorArgs() {
		return this.extractorArgs || null;
	}
	getConcurrentProducers() {
		return this.concurrentProducers;
	}
	getCookiesBrowser() {
		return this.cookiesBrowser || null;
	}
	getCookiesFile() {
		return this.cookiesFile || null;
	}
	getPluginDirs(): string[] {
		return this.pluginDirs
			? this.pluginDirs
					.split(":")
					.map((s) => s.trim())
					.filter(Boolean)
			: [];
	}

	async enable(configManagerApiContext: ConfigManagerApiContext) {
		this.api = configManagerApiContext;

		this.extractorArgs =
			(await this.api.getValue("extractor-args", "string")) ?? "";
		this.concurrentProducers =
			(await this.api.getValue("concurrent-producers", "integer")) ?? 3;
		this.cookiesBrowser =
			(await this.api.getValue("cookies-browser", "string")) ?? "";
		this.cookiesFile =
			(await this.api.getValue("cookies-file", "string")) ?? "";
		this.pluginDirs = (await this.api.getValue("plugin-dirs", "string")) ?? "";
	}

	async getConfigOptions(): Promise<ConfigNode> {
		return {
			type: "section",
			children: [
				{
					type: "section",
					children: [
						{ type: "heading", content: "YT-DLP", size: "sm" },
						{
							type: "text",
							id: "extractor-args",
							placeholder:
								"youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416",
							value: this.extractorArgs,
							name: "Extractor Arguments",
						},
						{
							type: "text",
							id: "plugin-dirs",
							placeholder: "/path/to/bgutil-ytdlp-pot-provider/plugin",
							value: this.pluginDirs,
							name: "Plugin Directories (colon separated)",
						},
						{
							type: "text",
							id: "concurrent-producers",
							placeholder: "3",
							value: this.concurrentProducers.toString(),
							name: "Concurrent Audio Producers",
						},
						{
							type: "text",
							id: "cookies-browser",
							placeholder: "firefox",
							value: this.cookiesBrowser,
							name: "Cookies Browser (for authentication)",
						},
						{
							type: "text",
							id: "cookies-file",
							placeholder: "/path/to/cookies.txt",
							value: this.cookiesFile,
							name: "Cookies File (for authentication)",
						},
					],
				},
			],
		};
	}

	async update(values: Record<string, any>): Promise<ConfigNode> {
		const extractorArgs: string | undefined = values["extractor-args"]?.trim();
		if (typeof extractorArgs == "string") {
			if (extractorArgs != this.extractorArgs) {
				this.extractorArgs = extractorArgs;
				if (extractorArgs) {
					await this.api.setValue("extractor-args", "string", extractorArgs);
				} else {
					this.api.delete("extractor-args");
				}
			}
		}

		const concurrentProducers = parseInt(values["concurrent-producers"]);
		if (!isNaN(concurrentProducers) && concurrentProducers > 0) {
			if (concurrentProducers != this.concurrentProducers) {
				this.concurrentProducers = concurrentProducers;
				await this.api.setValue(
					"concurrent-producers",
					"integer",
					concurrentProducers,
				);
			}
		}

		const cookiesBrowser: string | undefined =
			values["cookies-browser"]?.trim();
		if (typeof cookiesBrowser == "string") {
			if (cookiesBrowser != this.cookiesBrowser) {
				this.cookiesBrowser = cookiesBrowser;
				if (cookiesBrowser) {
					await this.api.setValue("cookies-browser", "string", cookiesBrowser);
				} else {
					this.api.delete("cookies-browser");
				}
			}
		}

		const cookiesFile: string | undefined = values["cookies-file"]?.trim();
		if (typeof cookiesFile == "string") {
			if (cookiesFile != this.cookiesFile) {
				this.cookiesFile = cookiesFile;
				if (cookiesFile) {
					await this.api.setValue("cookies-file", "string", cookiesFile);
				} else {
					this.api.delete("cookies-file");
				}
			}
		}

		const pluginDirs: string | undefined = values["plugin-dirs"]?.trim();
		if (typeof pluginDirs == "string") {
			if (pluginDirs != this.pluginDirs) {
				this.pluginDirs = pluginDirs;
				if (pluginDirs) {
					await this.api.setValue("plugin-dirs", "string", pluginDirs);
				} else {
					this.api.delete("plugin-dirs");
				}
			}
		}

		return this.getConfigOptions();
	}
}
