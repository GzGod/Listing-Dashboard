import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/generated/**", "**/*.cjs", "templates/**", "**/dist/**", "**/next-env.d.ts", "**/*.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // React hooks 规则：模块里的 // eslint-disable-next-line react-hooks/exhaustive-deps 注释要有对应插件才不报错
  { files: ["**/*.tsx", "**/*.ts"], plugins: { "react-hooks": reactHooks }, rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" } },
  { rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }] } },
);
