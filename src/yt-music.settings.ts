import { ConfigManager, ConfigManagerApiContext, ConfigNode } from "@sdk";

export class YTMusicConfigManager implements ConfigManager {
	private api!: ConfigManagerApiContext;

	private extractorArgs = "";
	private concurrentProducers = 1;

	getExtractorArgs() {
		return this.extractorArgs || null;
	}
	getConcurrentProducers() {
		return this.concurrentProducers;
	}

	async enable(configManagerApiContext: ConfigManagerApiContext) {
		this.api = configManagerApiContext;

		this.extractorArgs =
			(await this.api.getValue("extractor-args", "string")) ?? "";
		this.concurrentProducers =
			(await this.api.getValue("concurrent-producers", "integer")) ?? 3;
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
							id: "concurrent-producers",
							placeholder: "3",
							value: this.concurrentProducers.toString(),
							name: "Concurrent Audio Producers",
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

		return this.getConfigOptions();
	}
}
