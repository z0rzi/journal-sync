/** HTTPS form of a GitHub remote, since the plugin cannot use SSH (ADR 0001). */
export function httpsRemote(url: string): string {
	const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(url);
	if (scp) return `https://${scp[1]}/${scp[2]}`;
	const ssh = /^ssh:\/\/[\w.-]+@([\w.-]+)\/(.+)$/.exec(url);
	if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
	return url;
}

export interface FolderTemplate {
	folder: string;
	template: string;
}

/** Template Templater applies to a new note at `path`, from its folder templates. */
export function templatePathFor(path: string, folders: FolderTemplate[]): string | null {
	let best: FolderTemplate | null = null;
	for (const f of folders) {
		const folder = f.folder.replace(/\/$/, '');
		if (!path.startsWith(`${folder}/`) && folder !== '/' && folder !== '') continue;
		if (!best || folder.length > best.folder.replace(/\/$/, '').length) best = f;
	}
	if (!best?.template) return null;
	return best.template.endsWith('.md') ? best.template : `${best.template}.md`;
}
