import Keyv from "keyv";
import KeyvSqlite from "@keyv/sqlite";
import { deserializeAllThumbnails } from "../utils.js";

const TTL = 90 * 86400 * 1000;

export class PersistentCache {
	private readonly keyv: Keyv;

	constructor(dbFile: string) {
		this.keyv = new Keyv(new KeyvSqlite(`sqlite://${dbFile}`));
	}

	async set(key: string, value: any) {
		await this.keyv.set(key, value, TTL);
	}

	async get<T>(key: string): Promise<T | null> {
		const value = await this.keyv.get(key);
		if (typeof value == "object") {
			deserializeAllThumbnails(value);
		}
		return value ?? null;
	}

	async getMany<T>(keys: string[]): Promise<(T | null)[]> {
		const values = await this.keyv.getMany(keys);
		return values.map((value) => value ?? null);
	}

	async getOrFind<T>(
		key: string,
		orFind: () => Promise<T>,
		options: {
			ttl?: number;
		} = {},
	) {
		const existingValue = await this.get<T>(key);
		if (existingValue) {
			if (typeof existingValue == "object") {
				deserializeAllThumbnails(existingValue);
			}
			return existingValue;
		}

		try {
			const value = await orFind();
			await this.keyv.set(key, value, options.ttl ?? TTL);
			if (typeof value == "object") {
				deserializeAllThumbnails(value);
			}
			return value;
		} catch (e) {
			throw e;
		}
	}
}
