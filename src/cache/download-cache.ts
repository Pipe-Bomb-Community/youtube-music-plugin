import { PassThrough } from "stream";

export class DownloadCache {
	private data: Buffer;
	private written = 0;
	private done = false;
	private error: Error | null = null;
	private readonly waiters: Array<{
		needed: number;
		resolve: () => void;
		reject: (e: Error) => void;
	}> = [];

	constructor(capacity: number) {
		this.data = Buffer.allocUnsafe(Math.ceil(capacity * 1.1));
	}

	get bytesWritten(): number {
		return this.written;
	}

	write(chunk: Buffer): void {
		const end = this.written + chunk.length;
		if (end > this.data.length) {
			const grown = Buffer.allocUnsafe(Math.ceil(end * 1.5));
			this.data.copy(grown, 0, 0, this.written);
			this.data = grown;
		}
		chunk.copy(this.data, this.written);
		this.written += chunk.length;
		this.notify();
	}

	finish(): void {
		this.done = true;
		this.notify();
	}

	fail(err: Error): void {
		if (this.error) return;
		this.error = err;
		this.notify();
	}

	waitFor(minBytes: number): Promise<void> {
		if (this.error) return Promise.reject(this.error);
		if (this.written >= minBytes || this.done) return Promise.resolve();
		return new Promise<void>((resolve, reject) => {
			this.waiters.push({ needed: minBytes, resolve, reject });
		});
	}

	getSlice(start: number, end: number): Buffer {
		return Buffer.from(
			this.data.subarray(start, Math.min(end + 1, this.written)),
		);
	}

	toReadable(): PassThrough {
		const pass = new PassThrough();
		let pos = 0;

		const push = (): void => {
			while (pos < this.written) {
				const slice = Buffer.from(this.data.subarray(pos, this.written));
				pos = this.written;
				if (!pass.write(slice)) {
					pass.once("drain", push);
					return;
				}
			}
			if (this.error) {
				if (!pass.destroyed) pass.destroy(this.error);
				return;
			}
			if (this.done) {
				if (!pass.writableEnded) pass.end();
				return;
			}
			this.waiters.push({
				needed: pos + 1,
				resolve: push,
				reject: (err) => {
					if (!pass.destroyed) pass.destroy(err);
				},
			});
		};

		push();
		return pass;
	}

	private notify(): void {
		const next: typeof this.waiters = [];
		for (const w of this.waiters) {
			if (this.error) {
				w.reject(this.error);
			} else if (this.written >= w.needed || this.done) {
				w.resolve();
			} else {
				next.push(w);
			}
		}
		this.waiters.length = 0;
		this.waiters.push(...next);
	}
}
