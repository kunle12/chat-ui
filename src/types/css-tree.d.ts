declare module "css-tree" {
	export interface CssNode {
		type: string;
		[key: string]: unknown;
	}
	export interface CssLocation {
		line: number;
		column: number;
		offset: number;
	}
	export function parse(
		css: string,
		options?: {
			context?: string;
			parseValue?: boolean;
			parseAtrulePrelude?: boolean;
			parseRulePrelude?: boolean;
			positions?: boolean;
			filename?: string;
			[key: string]: unknown;
		}
	): CssNode;
	export function walk(
		ast: CssNode,
		handlers: ((node: CssNode, context: unknown) => void) | Record<string | symbol, unknown>,
		context?: unknown
	): void;
	export function generate(ast: CssNode, options?: Record<string, unknown>): string;
	export const version: string;
}
