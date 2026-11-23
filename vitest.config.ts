import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts'],
		testTimeout: 20000,
	},
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL('./test/mocks/obsidian.ts', import.meta.url)),
		},
	},
});
