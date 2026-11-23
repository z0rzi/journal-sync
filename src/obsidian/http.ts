import { requestUrl } from 'obsidian';
import type { GitHttpRequest, GitHttpResponse, HttpClient } from 'isomorphic-git';

/** isomorphic-git HTTP through Obsidian's requestUrl, which has no CORS limits on the phone. */
export const obsidianHttp: HttpClient = {
	async request(req: GitHttpRequest): Promise<GitHttpResponse> {
		let body: ArrayBuffer | undefined;
		if (req.body) {
			const chunks: Uint8Array[] = [];
			for await (const chunk of req.body) chunks.push(chunk);
			const total = chunks.reduce((n, c) => n + c.length, 0);
			const joined = new Uint8Array(total);
			let at = 0;
			for (const c of chunks) {
				joined.set(c, at);
				at += c.length;
			}
			body = joined.buffer;
		}
		const res = await requestUrl({
			url: req.url,
			method: req.method ?? 'GET',
			headers: req.headers,
			body,
			throw: false,
		});
		const data = new Uint8Array(res.arrayBuffer);
		return {
			url: req.url,
			method: req.method,
			statusCode: res.status,
			statusMessage: String(res.status),
			headers: res.headers,
			body: (async function* () {
				yield data;
			})(),
		};
	},
};
