import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores } from 'eslint/config';

export default tseslint.config(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'test/mocks/obsidian.ts',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json', 'vitest.config.ts'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Tests run in Node against real git repositories, not inside Obsidian.
		files: ['test/**/*.ts', 'vitest.config.ts'],
		languageOptions: { globals: { ...globals.node } },
		rules: {
			'import/no-nodejs-modules': 'off',
			'obsidianmd/hardcoded-config-path': 'off',
			'obsidianmd/prefer-window-timers': 'off',
		},
	},
);
