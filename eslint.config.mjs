import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Salida de compilación (vinext) y paquetes generados: no es código fuente.
    "dist/**",
    ".wrangler/**",
    "vendor/**",
  ]),
  {
    // Reglas del React Compiler (eslint-plugin-react-hooks v6). La app NO usa React Compiler (ni vinext ni next.config lo activan):
    // estas reglas avisan de patrones que impiden esa optimización (setState al montar, «último valor» en refs, Date.now en render),
    // no de errores de ejecución. Quedan como avisos para corregirlas de a poco sin arriesgar flujos de iPhone ya probados.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
