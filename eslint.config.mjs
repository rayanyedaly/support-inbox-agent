import next from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  { ignores: [".next/**", "out/**", "build/**", "node_modules/**", "infra/**"] },
  ...next,
];

export default eslintConfig;
