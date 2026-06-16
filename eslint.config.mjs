import next from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  { ignores: [".next/**", "out/**", "build/**", "node_modules/**"] },
  ...next,
];

export default eslintConfig;
