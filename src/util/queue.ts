type QueueCallback<T> = () => Promise<T>;

type QueueEntry<T> = {
	callback: QueueCallback<T>;
	resolve: (result: any) => void;
	reject: (error: any) => void;
};

export class Queue {
	private queue: QueueEntry<unknown>[] = [];
	private active = false;
	private lastRequest = Date.now();

	constructor(private readonly delay: number) {}

	add<T>(callback: QueueCallback<T>) {
		return new Promise<T>((resolve, reject) => {
			this.queue.push({
				callback,
				resolve,
				reject,
			});
			this.checkActivity();
		});
	}

	private async checkActivity() {
		if (this.active || !this.queue.length) {
			return;
		}

		const entry = this.queue[0]!;

		this.active = true;
		const delay = this.lastRequest + this.delay - Date.now();
		if (delay > 0) {
			await new Promise<void>((r) => setTimeout(r, delay));
		}

		this.lastRequest = Date.now();
		entry
			.callback()
			.then(entry.resolve)
			.catch(entry.reject)
			.finally(() => {
				const index = this.queue.indexOf(entry);
				if (index >= 0) this.queue.splice(index, 1);
				setImmediate(() => {
					this.active = false;
					this.checkActivity();
				});
			});
	}
}
