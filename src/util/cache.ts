interface Options {
	maxEntries?: number;
	timeout?: number;
}

interface Entry<T> {
	value: T;
	timeout: NodeJS.Timeout | null;
}

export class Cache<K, V> {
	private readonly cache = new Map<K, Entry<V>>();
	private readonly insertionOrder: K[] = [];

	constructor(private readonly options: Options) {}

	delete(key: K) {
		const entry = this.cache.get(key);
		if (entry) {
			if (entry.timeout) {
				clearTimeout(entry.timeout);
			}
			this.cache.delete(key);
		}
		const index = this.insertionOrder.indexOf(key);
		if (index >= 0) {
			this.insertionOrder.splice(index, 1);
		}
	}

	set(key: K, value: V) {
		if (this.cache.has(key)) {
			this.delete(key);
		}
		const entry: Entry<V> = {
			value,
			timeout: null,
		};
		if (this.options.timeout) {
			entry.timeout = setTimeout(() => this.delete(key), this.options.timeout);
		}
		this.cache.set(key, entry);
		this.insertionOrder.push(key);
		if (this.options.maxEntries) {
			while (this.insertionOrder.length > this.options.maxEntries) {
				this.delete(this.insertionOrder.shift()!);
			}
		}
	}

	get(key: K) {
		const entry = this.cache.get(key);
		if (entry) {
			return entry.value;
		}
		return null;
	}
}
